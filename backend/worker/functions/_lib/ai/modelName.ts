/**
 * VinaX AI — a readable name for a model id that is no longer in the
 * registry (a model dropped from models.ts, or one the old model discovery
 * found), so an old chat's replies still say which model wrote them.
 */
const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

const UPPER: Record<string, string> = {
  gpt: 'GPT', oss: 'OSS', vl: 'VL', ai: 'AI', llm: 'LLM', moe: 'MoE', fp8: 'FP8', fp16: 'FP16', awq: 'AWQ', int4: 'INT4', int8: 'INT8',
  r1: 'R1', qwq: 'QwQ', glm: 'GLM', sql: 'SQL', xl: 'XL', xs: 'XS', xxl: 'XXL', ii: 'II', iii: 'III', hf: 'HF', it: '', instruct: '',
  deepseek: 'DeepSeek', openai: 'OpenAI', nvidia: 'NVIDIA', ibm: 'IBM', lfm: 'LFM', mistral: 'Mistral', phi: 'Phi', allam: 'ALLaM',
};

/** `meta-llama/llama-3.3-70b-instruct:free` → `Llama 3.3 70B`. */
export function prettyName(upstream: string): string {
  const last = upstream.replace(/^@(?:cf|hf)\//, '').replace(/:free$/, '').split('/').pop() ?? upstream;
  const words = last.split(/[-_\s]+/).filter(Boolean).map((w) => {
    const l = w.toLowerCase();
    if (own(UPPER, l)) return UPPER[l];
    if (/^a?\d+(?:\.\d+)?[bmkt]$/.test(l)) return l.toUpperCase();
    if (/^[\d.]+$|^v\d/.test(l)) return l;
    return l.charAt(0).toUpperCase() + l.slice(1);
  }).filter(Boolean);
  return (words.join(' ') || upstream).slice(0, 80);
}
