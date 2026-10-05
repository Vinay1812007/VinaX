import { describe, expect, it } from 'vitest';
import { buildTimeline, distinctHosts, hostOf, liveLabel } from './toolTimeline';
import type { AgentStep } from './types';

const STEPS: AgentStep[] = [
  { tool: 'search', label: 'Searched the web for “monsoon ragas”' },
  { tool: 'visit', label: 'Read example.com' },
  { tool: 'code', label: 'Ran code' },
];

describe('liveLabel', () => {
  it('puts the service’s past-tense labels in the present while a step runs', () => {
    expect(liveLabel('Searched the web for “x”', true)).toBe('Searching the web for “x”');
    expect(liveLabel('Read example.com', true)).toBe('Reading example.com');
    expect(liveLabel('Ran code', true)).toBe('Running code');
    expect(liveLabel('Opened a page', true)).toBe('Opening a page');
    expect(liveLabel('Used a tool', true)).toBe('Using a tool');
  });
  it('leaves a finished step, and an unknown label, exactly as sent', () => {
    expect(liveLabel('Ran code', false)).toBe('Ran code');
    expect(liveLabel('Checked the score', true)).toBe('Checked the score');
  });
});

describe('hosts', () => {
  it('drops www. and keeps each host once, in source order', () => {
    expect(hostOf('https://www.example.com/a?b')).toBe('example.com');
    expect(hostOf('not a url')).toBe('');
    expect(distinctHosts(['https://a.example/1', 'https://www.a.example/2', 'https://b.example', 'junk'])).toEqual(['a.example', 'b.example']);
  });
});

describe('buildTimeline', () => {
  it('is empty when the stream reported no tools and no search', () => {
    const t = buildTimeline({ working: false, answering: true });
    expect(t.rows).toEqual([]);
    expect(t.summary).toBe('');
  });

  it('marks only the newest step as running while the reply is worked on and no text has come', () => {
    const t = buildTimeline({ steps: STEPS, working: true, answering: false });
    expect(t.rows.map((r) => r.status)).toEqual(['done', 'done', 'running']);
    expect(t.rows[2].label).toBe('Running code');
    expect(t.rows[0].label).toBe('Searched the web for “monsoon ragas”');
    expect(t.running).toBe(true);
  });

  it('marks every step done once answer text arrives, and when the reply finishes', () => {
    expect(buildTimeline({ steps: STEPS, working: true, answering: true }).rows.every((r) => r.status === 'done')).toBe(true);
    const done = buildTimeline({ steps: STEPS, working: false, answering: true });
    expect(done.running).toBe(false);
    expect(done.summary).toBe('Used 3 tools');
  });

  it('turns the service’s web search into a row with its real source count and hosts', () => {
    const sources = ['https://a.example/1', 'https://b.example/2', 'https://a.example/3'];
    const t = buildTimeline({ sources, working: false, answering: true });
    expect(t.rows).toEqual([
      { tool: 'search', label: 'Searched the web', status: 'done', hosts: ['a.example', 'b.example'], sourceCount: 3 },
    ]);
    expect(t.summary).toBe('Searched the web · 3 sources');
    expect(buildTimeline({ sources: sources.slice(0, 1), working: false, answering: true }).summary).toBe('Searched the web · 1 source');
  });

  it('counts the search and the agent’s own tools together, and never invents a count', () => {
    const t = buildTimeline({ steps: STEPS.slice(2), sources: ['https://a.example'], working: false, answering: true });
    expect(t.rows.map((r) => r.label)).toEqual(['Searched the web', 'Ran code']);
    expect(t.summary).toBe('Used 2 tools · 1 source');
    // No sources reported: no "sources" in the line at all.
    expect(buildTimeline({ steps: STEPS.slice(0, 1), working: false, answering: true }).summary).toBe('Searched the web');
    expect(buildTimeline({ steps: STEPS.slice(1, 2), working: false, answering: true }).summary).toBe('Used 1 tool');
  });
});
