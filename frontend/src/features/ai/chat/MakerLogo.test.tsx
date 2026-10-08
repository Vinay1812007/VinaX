// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BRAND_MARKS } from './brandMarks';
import { makerFamily } from './chatStyle';
import { hasMakerLogo, MakerLogo, makerName } from './MakerLogo';

afterEach(cleanup);

describe('maker logos (11.3.2)', () => {
  it('the live catalogue’s models land on their makers', () => {
    expect(makerFamily('gemini-3.5-flash-lite', 'Google', 'gemini')).toBe('google');
    expect(makerFamily('@cf/meta/llama-3.3-70b-instruct-fp8-fast', 'Meta', 'cloudflare')).toBe('meta');
    expect(makerFamily('mistralai/mistral-large', null, 'nvidia')).toBe('mistral');
    expect(makerFamily('deepseek-ai/deepseek-v4.1-flash', null, 'nvidia')).toBe('deepseek');
    expect(makerFamily('qwen/qwen3.8-27b', null, 'groq')).toBe('qwen');
    expect(makerFamily('moonshotai/kimi-k3', null, 'nvidia')).toBe('moonshot');
    expect(makerFamily('openai/gpt-oss-120b', 'OpenAI', 'groq')).toBe('openai');
    // By answered-by name alone (a reply stores the name, not the slug).
    expect(makerFamily('Llama 3.3 70B Instruct', null, 'cloudflare')).toBe('meta');
    expect(makerFamily('GPT-OSS 20B', null, 'groq')).toBe('openai');
  });

  it('a real outline on the brand’s tile; a letter tile where no outline exists; the provider when unknown', () => {
    const { container, rerender } = render(<MakerLogo family="google" size={20} />);
    expect(container.querySelector('svg')?.getAttribute('data-maker')).toBe('google');
    expect(container.querySelector('rect')?.getAttribute('fill')).toBe(BRAND_MARKS.google.hex);
    expect(container.querySelector('path')?.getAttribute('d')).toBe(BRAND_MARKS.google.path);
    rerender(<MakerLogo family="openai" />);
    expect(container.querySelector('text')?.textContent).toBe('O');
    expect(container.querySelector('path')).toBeNull();
    rerender(<MakerLogo family="other" provider="groq" />);
    expect(container.querySelector('svg')?.getAttribute('data-provider')).toBe('groq');
    rerender(<MakerLogo family="other" />);
    expect(container.querySelector('svg')).toBeNull();
    expect(hasMakerLogo('other')).toBe(false);
    expect(makerName('meta')).toBe('Meta');
  });

  it('labelled when it stands alone, hidden beside visible text', () => {
    const { container, rerender } = render(<MakerLogo family="meta" />);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    rerender(<MakerLogo family="meta" label="Meta" />);
    expect(container.querySelector('svg')?.getAttribute('role')).toBe('img');
    expect(container.querySelector('title')?.textContent).toBe('Meta');
  });
});
