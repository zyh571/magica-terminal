//! `space`: walks a folder tree in a background thread; sizes add up toward the top as it goes, so the view can show
//! them growing. Disk space actually used (allocated blocks, like du) on Unix, file sizes on Windows. Stays on one
//! filesystem, doesn't follow links, and counts hard-linked files once.

use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

struct Node {
    name: String,   // the full path for a root
    parent: Option<usize>,
    size: u64,
    children: Option<HashMap<String, usize>>,   // None: not a folder
    listed: bool,
    error: Option<String>,
}

#[derive(Default)]
struct Tree {
    nodes: Vec<Node>,
    root: usize,
    seen: HashSet<(u64, u64)>,   // (device, inode) of files with several hard links
}

impl Tree {
    fn path(&self, mut id: usize) -> PathBuf {
        let mut parts = Vec::new();
        loop {
            let n = &self.nodes[id];
            parts.push(n.name.clone());
            match n.parent {
                Some(p) => id = p,
                None => break,
            }
        }
        parts.iter().rev().collect()
    }

    fn add(&mut self, mut id: usize, size: u64) {
        loop {
            self.nodes[id].size += size;
            match self.nodes[id].parent {
                Some(p) => id = p,
                None => break,
            }
        }
    }
}

/// One item as the view shows it.
#[derive(Serialize, Clone, Debug)]
pub struct Item {
    pub id: usize,
    pub name: String,
    pub size: u64,
    pub folder: bool,
    pub listed: bool,
    pub error: Option<String>,
}

/// A folder as the view shows it: its own numbers and its items, biggest first.
#[derive(Serialize, Clone, Debug)]
pub struct NodeView {
    pub id: usize,
    pub path: String,
    pub size: u64,
    pub folder: bool,
    pub listed: bool,
    pub error: Option<String>,
    pub parent: Option<usize>,
    pub children: Vec<Item>,
}

pub struct DiskScan {
    tree: Arc<Mutex<Tree>>,
    running: Arc<AtomicUsize>,
    stopped: Arc<AtomicBool>,
}

struct Entry {
    size: u64,
    folder: bool,
    same_fs: bool,
}

#[cfg(unix)]
fn entry(m: &std::fs::Metadata, dev: Option<u64>, seen: &mut HashSet<(u64, u64)>) -> Entry {
    use std::os::unix::fs::MetadataExt;
    let folder = m.file_type().is_dir();
    let mut size = m.blocks() * 512;
    if m.nlink() > 1 && !folder && !seen.insert((m.dev(), m.ino())) {
        size = 0;
    }
    Entry { size, folder, same_fs: dev.is_none_or(|d| d == m.dev()) }
}

#[cfg(windows)]
fn entry(m: &std::fs::Metadata, _dev: Option<u64>, _seen: &mut HashSet<(u64, u64)>) -> Entry {
    use std::os::windows::fs::MetadataExt;
    const REPARSE_POINT: u32 = 0x400;   // junctions and other mount-like folders: shown, not entered
    let folder = m.file_type().is_dir();
    Entry { size: if folder { 0 } else { m.len() }, folder, same_fs: m.file_attributes() & REPARSE_POINT == 0 }
}

#[cfg(unix)]
fn device(p: &Path) -> Option<u64> {
    use std::os::unix::fs::MetadataExt;
    std::fs::symlink_metadata(p).ok().map(|m| m.dev())
}

#[cfg(windows)]
fn device(_p: &Path) -> Option<u64> {
    None
}

impl DiskScan {
    /// Start scanning `path`.
    pub fn new(path: &Path) -> Self {
        let s = Self { tree: Default::default(), running: Default::default(), stopped: Default::default() };
        s.start(path, None);
        s
    }

    fn start(&self, path: &Path, inside: Option<usize>) -> usize {
        let mut t = self.tree.lock().unwrap();
        let root = t.nodes.len();
        t.nodes.push(Node {
            name: path.to_string_lossy().into_owned(),
            parent: None,
            size: 0,
            children: Some(HashMap::new()),
            listed: false,
            error: None,
        });
        let mut skip = None;
        if let Some(old) = inside {
            let name = Path::new(&t.nodes[old].name).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            t.nodes[old].name = name.clone();
            t.nodes[old].parent = Some(root);
            let size = t.nodes[old].size;
            t.nodes[root].size = size;
            t.nodes[root].children.as_mut().unwrap().insert(name.clone(), old);
            skip = Some(name);
        }
        t.root = root;
        drop(t);
        self.running.fetch_add(1, Ordering::SeqCst);
        let (tree, running, stopped) = (self.tree.clone(), self.running.clone(), self.stopped.clone());
        std::thread::spawn(move || {
            walk(&tree, root, skip.as_deref(), &stopped);
            running.fetch_sub(1, Ordering::SeqCst);
        });
        root
    }

    /// Go up past where it started: scan `path`, the parent of the current root `inside`, keeping what's scanned.
    pub fn start_parent(&self, path: &Path, inside: usize) -> usize {
        self.start(path, Some(inside))
    }

    pub fn root(&self) -> usize {
        self.tree.lock().unwrap().root
    }

    pub fn running(&self) -> bool {
        self.running.load(Ordering::SeqCst) > 0
    }

    pub fn stop(&self) {
        self.stopped.store(true, Ordering::SeqCst);
    }

    pub fn path(&self, id: usize) -> PathBuf {
        self.tree.lock().unwrap().path(id)
    }

    pub fn child(&self, id: usize, name: &str) -> Option<usize> {
        self.tree.lock().unwrap().nodes.get(id)?.children.as_ref()?.get(name).copied()
    }

    pub fn view(&self, id: usize) -> Option<NodeView> {
        let t = self.tree.lock().unwrap();
        let n = t.nodes.get(id)?;
        let mut children: Vec<Item> = n
            .children
            .iter()
            .flatten()
            .map(|(name, &c)| {
                let c_node = &t.nodes[c];
                Item { id: c, name: name.clone(), size: c_node.size, folder: c_node.children.is_some(), listed: c_node.listed, error: c_node.error.clone() }
            })
            .collect();
        children.sort_by(|a, b| b.size.cmp(&a.size).then_with(|| a.name.cmp(&b.name)));
        Some(NodeView {
            id,
            path: t.path(id).to_string_lossy().into_owned(),
            size: n.size,
            folder: n.children.is_some(),
            listed: n.listed,
            error: n.error.clone(),
            parent: n.parent,
            children,
        })
    }
}

impl Drop for DiskScan {
    fn drop(&mut self) {
        self.stop();
    }
}

fn walk(tree: &Mutex<Tree>, root: usize, skip: Option<&str>, stopped: &AtomicBool) {
    let root_path = tree.lock().unwrap().path(root);
    let dev = device(&root_path);
    let mut stack = vec![root];
    while let Some(id) = stack.pop() {
        if stopped.load(Ordering::SeqCst) {
            return;
        }
        let path = tree.lock().unwrap().path(id);
        let (entries, error) = match std::fs::read_dir(&path) {
            Ok(rd) => (rd.flatten().collect::<Vec<_>>(), None),
            Err(e) => (Vec::new(), Some(e.to_string())),
        };
        let mut t = tree.lock().unwrap();
        t.nodes[id].error = error;
        let mut total = 0;
        for e in entries {
            let name = e.file_name().to_string_lossy().into_owned();
            if id == root && Some(name.as_str()) == skip {
                continue;
            }
            let Ok(m) = e.metadata() else { continue };   // (DirEntry::metadata doesn't follow links)
            let en = entry(&m, dev, &mut t.seen);
            let child = t.nodes.len();
            let folder = en.folder;
            t.nodes.push(Node {
                name: name.clone(),
                parent: Some(id),
                size: en.size,
                children: folder.then(HashMap::new),
                listed: !folder,
                error: None,
            });
            total += en.size;
            t.nodes[id].children.get_or_insert_with(HashMap::new).insert(name, child);
            if folder {
                if en.same_fs {
                    stack.push(child);
                } else {   // another filesystem mounted here: left out
                    t.nodes[child].listed = true;
                    t.nodes[child].error = Some("other filesystem".into());
                }
            }
        }
        t.nodes[id].listed = true;
        t.add(id, total);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::time::{Duration, Instant};

    #[cfg(unix)]
    fn du(p: &Path) -> u64 {
        use std::os::unix::fs::MetadataExt;
        let m = std::fs::symlink_metadata(p).unwrap();
        let mut total = m.blocks() * 512;
        if m.is_dir() {
            for e in std::fs::read_dir(p).unwrap() {
                total += du(&e.unwrap().path());
            }
        }
        total
    }

    fn wait(s: &DiskScan) {
        let end = Instant::now() + Duration::from_secs(10);
        while s.running() && Instant::now() < end {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(!s.running());
    }

    fn write(p: &Path, n: usize) {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, (0..n).map(|i| (i * 7919 % 251) as u8).collect::<Vec<_>>()).unwrap();
    }

    #[cfg(unix)]
    fn tree() -> (tempfile::TempDir, std::path::PathBuf) {
        let d = tempfile::tempdir().unwrap();
        let top = d.path().join("top");
        write(&top.join("big.bin"), 300_000);
        write(&top.join("a/one.bin"), 50_000);
        write(&top.join("a/deep/two.bin"), 120_000);
        write(&top.join("b/small.txt"), 10);
        #[cfg(unix)]
        std::os::unix::fs::symlink("/usr", top.join("link")).unwrap();
        (d, top)
    }

    #[cfg(unix)]
    #[test]
    fn sizes_match_du() {
        let (_d, top) = tree();
        let s = DiskScan::new(&top);
        wait(&s);
        let root = s.view(s.root()).unwrap();
        assert_eq!(root.size, du(&top));
        let a = s.child(s.root(), "a").unwrap();
        assert_eq!(s.view(a).unwrap().size, du(&top.join("a")));
        let deep = s.child(a, "deep").unwrap();
        assert_eq!(s.view(deep).unwrap().size, du(&top.join("a/deep")));
        assert_eq!(s.path(deep), top.join("a/deep"));
        let link = root.children.iter().find(|c| c.name == "link").unwrap();
        assert!(!link.folder);
        assert!(root.children.iter().all(|c| c.listed));
        // biggest first
        assert!(root.children.windows(2).all(|w| w[0].size >= w[1].size));
    }

    #[cfg(unix)]
    #[test]
    fn hard_links_counted_once() {
        use std::os::unix::fs::MetadataExt;
        let (_d, top) = tree();
        std::fs::hard_link(top.join("big.bin"), top.join("b/same.bin")).unwrap();
        let s = DiskScan::new(&top);
        wait(&s);
        let big = std::fs::metadata(top.join("big.bin")).unwrap().blocks() * 512;
        assert_eq!(s.view(s.root()).unwrap().size, du(&top) - big);
    }

    #[cfg(unix)]
    #[test]
    fn going_up_keeps_the_scanned_folder() {
        let (d, top) = tree();
        write(&d.path().join("sibling.bin"), 70_000);
        let s = DiskScan::new(&top);
        wait(&s);
        let old = s.root();
        let parent = s.start_parent(d.path(), old);
        wait(&s);
        assert_eq!(s.root(), parent);
        assert_eq!(s.child(parent, "top"), Some(old));
        assert_eq!(s.path(old), top);
        assert_eq!(s.view(parent).unwrap().size, du(d.path()));
    }

    #[cfg(unix)]
    #[test]
    fn unreadable_folder() {
        use std::os::unix::fs::PermissionsExt;
        let (_d, top) = tree();
        let locked = top.join("locked");
        std::fs::create_dir(&locked).unwrap();
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0)).unwrap();
        let s = DiskScan::new(&top);
        wait(&s);
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap();
        let id = s.child(s.root(), "locked").unwrap();
        if unsafe_is_root() {
            return;
        }
        assert!(s.view(id).unwrap().error.is_some());
    }

    #[cfg(unix)]
    fn unsafe_is_root() -> bool {
        std::env::var("USER").map(|u| u == "root").unwrap_or(false)
    }

    #[test]
    fn unicode_folder_with_space() {
        let d = tempfile::tempdir().unwrap();
        let top = d.path().join("pro j");
        write(&top.join("Zoë/x.bin"), 5000);
        let s = DiskScan::new(&top);
        wait(&s);
        let z = s.child(s.root(), "Zoë").unwrap();
        assert!(s.view(z).unwrap().size > 0);
        assert_eq!(s.path(z), top.join("Zoë"));
    }

    #[test]
    fn missing_folder_is_an_error_not_a_crash() {
        let s = DiskScan::new(Path::new("/nonexistent/folder"));
        wait(&s);
        assert!(s.view(s.root()).unwrap().error.is_some());
    }
}
