// ===================================================================
// FontRig — Pyodide FS Bridge
// ===================================================================
// Helpers to ferry files between a browser FileSystemDirectoryHandle
// (showDirectoryPicker) and Pyodide's in-memory virtual filesystem.
//
// Used by UFO IO: UfoConverter expects real filesystem paths, so we
// stage the picked folder into MEMFS, run Python on it, then copy the
// result back out to the user's chosen output handle.
// ===================================================================
'use strict';

FontRig.pyFs = {

	// -- Ensure a MEMFS directory tree exists (recursive mkdir -p) -----
	mkdirp: function(memfsPath) {
		var FS = FontRig.pyBridge.pyodide.FS;
		var parts = memfsPath.split('/').filter(function(p) { return p.length > 0; });
		var cur = '';
		for (var i = 0; i < parts.length; i++) {
			cur += '/' + parts[i];
			try { FS.mkdir(cur); } catch (e) { /* exists */ }
		}
	},

	// -- Wipe a MEMFS directory (best-effort) --------------------------
	rmrf: function(memfsPath) {
		var FS = FontRig.pyBridge.pyodide.FS;
		var stat;
		try { stat = FS.stat(memfsPath); } catch (e) { return; }
		if (FS.isDir(stat.mode)) {
			var entries = FS.readdir(memfsPath).filter(function(n) {
				return n !== '.' && n !== '..';
			});
			for (var i = 0; i < entries.length; i++) {
				FontRig.pyFs.rmrf(memfsPath + '/' + entries[i]);
			}
			try { FS.rmdir(memfsPath); } catch (e) {}
		} else {
			try { FS.unlink(memfsPath); } catch (e) {}
		}
	},

	// -- Recursively copy a FileSystemDirectoryHandle into MEMFS -------
	// Files land at <memfsPath>/<relative-path-inside-handle>.
	// Returns the count of files written.
	copyDirHandleToMemfs: async function(dirHandle, memfsPath) {
		var FS    = FontRig.pyBridge.pyodide.FS;
		var count = 0;
		FontRig.pyFs.mkdirp(memfsPath);

		// for-await iteration over directory entries (Chrome FS Access API).
		for await (var entry of dirHandle.values()) {
			var entryPath = memfsPath + '/' + entry.name;
			if (entry.kind === 'directory') {
				FontRig.pyFs.mkdirp(entryPath);
				count += await FontRig.pyFs.copyDirHandleToMemfs(entry, entryPath);
			} else {
				var file = await entry.getFile();
				var buf  = new Uint8Array(await file.arrayBuffer());
				FS.writeFile(entryPath, buf);
				count++;
			}
		}
		return count;
	},

	// -- Recursively copy a MEMFS directory out to a dirHandle ---------
	// Creates subdirectories on the handle as needed.
	copyMemfsToDirHandle: async function(memfsPath, dirHandle) {
		var FS = FontRig.pyBridge.pyodide.FS;
		var entries = FS.readdir(memfsPath).filter(function(n) {
			return n !== '.' && n !== '..';
		});

		var count = 0;
		for (var i = 0; i < entries.length; i++) {
			var name = entries[i];
			var srcPath = memfsPath + '/' + name;
			var stat = FS.stat(srcPath);
			if (FS.isDir(stat.mode)) {
				var subHandle = await dirHandle.getDirectoryHandle(name, { create: true });
				count += await FontRig.pyFs.copyMemfsToDirHandle(srcPath, subHandle);
			} else {
				var data = FS.readFile(srcPath); // Uint8Array
				var fh   = await dirHandle.getFileHandle(name, { create: true });
				var w    = await fh.createWritable();
				await w.write(data);
				await w.close();
				count++;
			}
		}
		return count;
	},

	// -- Read a UTF-8 text file from MEMFS -----------------------------
	readText: function(memfsPath) {
		var FS = FontRig.pyBridge.pyodide.FS;
		return FS.readFile(memfsPath, { encoding: 'utf8' });
	},

	// -- Write a UTF-8 text file to MEMFS (parents created) ------------
	writeText: function(memfsPath, text) {
		var FS = FontRig.pyBridge.pyodide.FS;
		var dir = memfsPath.substring(0, memfsPath.lastIndexOf('/'));
		if (dir) FontRig.pyFs.mkdirp(dir);
		FS.writeFile(memfsPath, text);
	},

	// -- List top-level entries (names only) ---------------------------
	listdir: function(memfsPath) {
		var FS = FontRig.pyBridge.pyodide.FS;
		return FS.readdir(memfsPath).filter(function(n) {
			return n !== '.' && n !== '..';
		});
	},
};
