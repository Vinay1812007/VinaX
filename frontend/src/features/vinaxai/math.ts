/**
 * VinaX AI — maths in replies ($inline$ and $$display$$), loaded only when a
 * reply contains a dollar sign: KaTeX, its CSS and fonts stay out of the
 * chat's own chunk and out of the service worker's precache.
 */
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

export { remarkMath, rehypeKatex };
