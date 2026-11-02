/**
 * VinaX music AI — GET /api/ai/generate-song/:jobId: how a generation is
 * going. While the music model works, each call asks it once and reports
 * how far the job probably is (from its age); when it finishes, the song is
 * copied into Worker storage (for GENERATED_TTL_SEC) and the answer carries
 * its address.
 *
 *   → 200 { status: queued | running | done | failed, progress, title?, durationSec, instrumental, audioUrl?, expiresAt }
 *   → 401 signed_out · 404 not_found (another account's job, an expired one or a malformed id)
 */
import { json } from '../../../_lib/authShared';
import { bearer, readSession } from '../../../_lib/googleAuth';
import { audioKey, estimatedProgress, fallbackTitle, fetchFinishedAudio, GENERATED_TTL_SEC, pollProviderJob, readJob, storageOf, writeJob, type GenEnv } from '../../../_lib/ai/songGen';

export const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface Ctx { request: Request; env: GenEnv; params: { id?: string } }

export const onRequestGet = async ({ request, env, params }: Ctx): Promise<Response> => {
  const sub = await readSession(env, bearer(request));
  if (!sub) return json({ error: 'signed_out' }, 401);
  const id = String(params.id ?? '');
  if (!JOB_ID.test(id)) return json({ error: 'not_found' }, 404);
  const job = await readJob(env, id);
  if (!job || job.owner !== sub) return json({ error: 'not_found' }, 404);
  let progress = job.status === 'done' ? 1 : 0;
  if ((job.status === 'queued' || job.status === 'running') && job.providerId) {
    const now = await pollProviderJob(env, job.providerId);
    if (now?.status === 'done') {
      const audio = await fetchFinishedAudio(env, now);
      if (audio) {
        await storageOf(env)!.put(audioKey(id), audio.bytes, { expirationTtl: GENERATED_TTL_SEC, metadata: { mime: audio.mime } });
        job.status = 'done';
        job.mime = audio.mime;
        job.title = (now.title ?? job.title)?.slice(0, 60) || fallbackTitle(job);
        await writeJob(env, id, job);
        progress = 1;
      } else {
        job.status = 'failed';
        await writeJob(env, id, job);
      }
    } else if (now?.status === 'failed') {
      job.status = 'failed';
      await writeJob(env, id, job);
    } else {
      // The model reports no progress, and a missed poll is not a failure: estimate from the job's age.
      progress = now?.progress || estimatedProgress(job.createdAt, job.durationSec);
      // One write when the model starts working; progress itself is never stored.
      if (now?.status === 'running' && job.status === 'queued') {
        job.status = 'running';
        await writeJob(env, id, job);
      }
    }
  }
  return json({
    status: job.status,
    progress,
    ...(job.title ? { title: job.title } : {}),
    durationSec: job.durationSec,
    instrumental: job.instrumental,
    ...(job.status === 'done' ? { audioUrl: `/api/ai/generate-song/${id}/audio` } : {}),
    expiresAt: job.createdAt + GENERATED_TTL_SEC * 1_000,
  });
};
