/*
 * Notebook Navigator - Plugin for Obsidian
 * Copyright (c) 2025-2026 Johan Sanneblad
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { describe, expect, it } from 'vitest';
import { TFile, TFolder } from 'obsidian';
import { getFolderNote, isFolderNote } from '../../src/utils/folderNotes';
import type { FolderNoteDetectionSettings } from '../../src/utils/folderNotes';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSettings(overrides: Partial<FolderNoteDetectionSettings> = {}): FolderNoteDetectionSettings {
    return {
        enableFolderNotes: true,
        folderNoteName: '',
        folderNoteNamePattern: '',
        folderNotePatterns: [],
        ...overrides
    };
}

/**
 * Builds a TFolder with the given children, plus a minimal vault stub that
 * `getFolderNote` uses for the exact-name resolution fallback.
 */
function makeFolder(folderPath: string, childPaths: string[]): TFolder {
    const folder = new TFolder(folderPath);
    (folder as unknown as { name: string }).name = folderPath.split('/').pop() ?? '';

    const files: TFile[] = childPaths.map(fp => {
        const file = new TFile(fp);
        (file as unknown as { parent: TFolder }).parent = folder;
        return file;
    });

    (folder as unknown as { children: TFile[] }).children = files;

    const fileMap = new Map(files.map(f => [f.path, f]));
    (folder as unknown as { vault: { getAbstractFileByPath: (p: string) => TFile | null } }).vault = {
        getAbstractFileByPath: (p: string) => fileMap.get(p) ?? null
    };

    return folder;
}

// ---------------------------------------------------------------------------
// getFolderNote — basic enable/disable guard
// ---------------------------------------------------------------------------

describe('getFolderNote — enableFolderNotes guard', () => {
    it('returns null when enableFolderNotes is false even if patterns are set', () => {
        const folder = makeFolder('Projects', ['Projects/index.md']);
        expect(getFolderNote(folder, makeSettings({ enableFolderNotes: false, folderNotePatterns: ['*.md'] }))).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// getFolderNote — glob pattern matching
// ---------------------------------------------------------------------------

describe('getFolderNote — folderNotePatterns', () => {
    it('matches a simple wildcard pattern against filename', () => {
        const folder = makeFolder('Projects', ['Projects/index.md']);
        const result = getFolderNote(folder, makeSettings({ folderNotePatterns: ['*.md'] }));
        expect(result?.name).toBe('index.md');
    });

    it('returns the first match when multiple files satisfy different patterns', () => {
        const folder = makeFolder('Projects', ['Projects/00 - Projects.md', 'Projects/index.md']);
        const result = getFolderNote(folder, makeSettings({ folderNotePatterns: ['index.md', '00 - *.md'] }));
        expect(result?.name).toBe('index.md');
    });

    it('skips non-matching patterns and returns the first that matches', () => {
        const folder = makeFolder('Projects', ['Projects/00 - Projects.md']);
        const result = getFolderNote(folder, makeSettings({ folderNotePatterns: ['index.md', '00 - *.md'] }));
        expect(result?.name).toBe('00 - Projects.md');
    });

    it('returns null when no pattern matches and no name fallback', () => {
        const folder = makeFolder('Projects', ['Projects/notes.md']);
        const result = getFolderNote(folder, makeSettings({ folderNotePatterns: ['index.md'] }));
        expect(result).toBeNull();
    });

    it('pattern match takes priority over folderNoteName exact match', () => {
        const folder = makeFolder('Projects', ['Projects/00 - Projects.md', 'Projects/index.md']);
        const result = getFolderNote(folder, makeSettings({ folderNoteName: 'index', folderNotePatterns: ['00 - *.md'] }));
        expect(result?.name).toBe('00 - Projects.md');
    });

    it('falls back to folderNoteName exact match when no pattern matches', () => {
        const folder = makeFolder('Projects', ['Projects/index.md', 'Projects/notes.md']);
        const result = getFolderNote(folder, makeSettings({ folderNoteName: 'index', folderNotePatterns: ['README.md'] }));
        expect(result?.name).toBe('index.md');
    });

    it('falls back to folder-name match when patterns empty and folderNoteName empty', () => {
        const folder = makeFolder('Projects', ['Projects/Projects.md']);
        const result = getFolderNote(folder, makeSettings({ folderNotePatterns: [] }));
        expect(result?.name).toBe('Projects.md');
    });

    it('only considers files with supported extensions', () => {
        const folder = makeFolder('Projects', ['Projects/index.txt', 'Projects/index.md']);
        const result = getFolderNote(folder, makeSettings({ folderNotePatterns: ['index.*'] }));
        expect(result?.extension).toBe('md');
    });

    it('ignores files from a different parent folder', () => {
        const folder = makeFolder('Projects', []);
        const alien = new TFile('Other/index.md');
        (alien as unknown as { parent: { path: string } }).parent = { path: 'Other' };
        (folder as unknown as { children: TFile[] }).children = [alien];
        const result = getFolderNote(folder, makeSettings({ folderNotePatterns: ['*.md'] }));
        expect(result).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// getFolderNote — matchGlob semantics (exercised through getFolderNote)
// ---------------------------------------------------------------------------

describe('getFolderNote — matchGlob wildcards', () => {
    it('* matches zero or more characters', () => {
        const folder = makeFolder('Notes', ['Notes/00 - Notes.md']);
        expect(getFolderNote(folder, makeSettings({ folderNotePatterns: ['00 - *.md'] }))).not.toBeNull();
    });

    it('* matches an empty string segment', () => {
        const folder = makeFolder('Notes', ['Notes/prefix.md']);
        expect(getFolderNote(folder, makeSettings({ folderNotePatterns: ['prefix*.md'] }))).not.toBeNull();
    });

    it('? matches exactly one character', () => {
        const folder = makeFolder('Notes', ['Notes/note1.md']);
        expect(getFolderNote(folder, makeSettings({ folderNotePatterns: ['note?.md'] }))).not.toBeNull();
    });

    it('? does not match zero characters', () => {
        const folder = makeFolder('Notes', ['Notes/note.md']);
        expect(getFolderNote(folder, makeSettings({ folderNotePatterns: ['note?.md'] }))).toBeNull();
    });

    it('? does not match two characters', () => {
        const folder = makeFolder('Notes', ['Notes/note12.md']);
        expect(getFolderNote(folder, makeSettings({ folderNotePatterns: ['note?.md'] }))).toBeNull();
    });

    it('matching is case-insensitive for the name portion', () => {
        // Obsidian always stores extensions as lowercase; the case-insensitivity
        // applies to the filename/basename portion of the match.
        const folder = makeFolder('Notes', ['Notes/INDEX.md']);
        expect(getFolderNote(folder, makeSettings({ folderNotePatterns: ['index.md'] }))).not.toBeNull();
    });

    it('regex-special chars in pattern are treated as literals', () => {
        const folder = makeFolder('Notes', ['Notes/(overview).md']);
        expect(getFolderNote(folder, makeSettings({ folderNotePatterns: ['(overview).md'] }))).not.toBeNull();
    });

    it('pattern with a dot matches against the full filename', () => {
        const folder = makeFolder('Notes', ['Notes/index.md']);
        // "index.md" has a dot → matched against file.name ("index.md") not file.basename ("index")
        expect(getFolderNote(folder, makeSettings({ folderNotePatterns: ['index.md'] }))).not.toBeNull();
    });

    it('pattern without a dot matches against the basename only', () => {
        const folder = makeFolder('Notes', ['Notes/index.md', 'Notes/index.canvas']);
        // "index" has no dot → matches against basename → first supported-ext file wins
        const result = getFolderNote(folder, makeSettings({ folderNotePatterns: ['index'] }));
        expect(result).not.toBeNull();
        expect(result?.basename).toBe('index');
    });

    it('dot-less pattern does not accidentally match via full filename', () => {
        const folder = makeFolder('Notes', ['Notes/summary.md']);
        // "sum" has no dot → must match basename "summary" → no match
        expect(getFolderNote(folder, makeSettings({ folderNotePatterns: ['sum'] }))).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// isFolderNote — delegation to getFolderNote
// ---------------------------------------------------------------------------

describe('isFolderNote — pattern-aware', () => {
    it('returns true for the file getFolderNote would return', () => {
        const folder = makeFolder('Projects', ['Projects/00 - Projects.md', 'Projects/notes.md']);
        const files = (folder as unknown as { children: TFile[] }).children;
        const settings = makeSettings({ folderNotePatterns: ['00 - *.md'] });
        expect(isFolderNote(files[0], folder, settings)).toBe(true);
        expect(isFolderNote(files[1], folder, settings)).toBe(false);
    });

    it('returns false for a file in a different folder', () => {
        const folder = makeFolder('Projects', ['Projects/index.md']);
        const alien = new TFile('Other/index.md');
        (alien as unknown as { parent: { path: string } }).parent = { path: 'Other' };
        const settings = makeSettings({ folderNotePatterns: ['*.md'] });
        expect(isFolderNote(alien, folder, settings)).toBe(false);
    });

    it('returns false for unsupported file extension', () => {
        const folder = makeFolder('Projects', ['Projects/index.txt']);
        const files = (folder as unknown as { children: TFile[] }).children;
        const settings = makeSettings({ folderNotePatterns: ['*.txt'] });
        expect(isFolderNote(files[0], folder, settings)).toBe(false);
    });

    it('returns false when enableFolderNotes is false', () => {
        const folder = makeFolder('Projects', ['Projects/index.md']);
        const files = (folder as unknown as { children: TFile[] }).children;
        const settings = makeSettings({ enableFolderNotes: false, folderNotePatterns: ['*.md'] });
        expect(isFolderNote(files[0], folder, settings)).toBe(false);
    });
});
