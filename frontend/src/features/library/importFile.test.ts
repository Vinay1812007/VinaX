import { describe, expect, it } from 'vitest';
import { csvToLines, fileToLines, m3uToLines, splitCsvRow } from './importFile';

describe('15.0 — playlist file import', () => {
  it('splits CSV rows with quoted commas and doubled quotes', () => {
    expect(splitCsvRow('"Naatu Naatu","Rahul Sipligunj, Kaala Bhairava",2022')).toEqual(['Naatu Naatu', 'Rahul Sipligunj, Kaala Bhairava', '2022']);
    expect(splitCsvRow('"Say ""Hi""",A')).toEqual(['Say "Hi"', 'A']);
  });

  it('reads the common export header names and keeps the first artist', () => {
    const csv = '﻿"Track URI","Track Name","Artist Name(s)","Album Name"\nx,"Kesariya","Arijit Singh;Pritam","Brahmastra"\ny,"Srivalli","Sid Sriram","Pushpa"\nz,"",A,B\n';
    expect(csvToLines(csv)).toEqual(['Kesariya — Arijit Singh', 'Srivalli — Sid Sriram']);
    expect(csvToLines('title,artist\nButta Bomma,Armaan Malik')).toEqual(['Butta Bomma — Armaan Malik']);
    expect(csvToLines('a,b\n1,2')).toBeNull();
  });

  it('reads M3U EXTINF labels as Title — Artist', () => {
    const m3u = '#EXTM3U\n#EXTINF:215,Sid Sriram - Samajavaragamana\nC:\\music\\s.mp3\n#EXTINF:-1 tvg-id="x",Oo Antava\n/x.mp3\n';
    expect(m3uToLines(m3u)).toEqual(['Samajavaragamana — Sid Sriram', 'Oo Antava']);
    expect(m3uToLines('just text')).toBeNull();
  });

  it('picks the parser by extension and falls back to plain lines', () => {
    expect(fileToLines('list.m3u8', '#EXTINF:1,A - B\nx')).toEqual(['B — A']);
    expect(fileToLines('notes.txt', 'Kesariya — Arijit Singh\nSrivalli')).toEqual(['Kesariya — Arijit Singh', 'Srivalli']);
    expect(fileToLines('export.csv', 'title,artist\nX,Y')).toEqual(['X — Y']);
  });
});
