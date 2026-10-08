import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyRows, remapIds } from './guest.ts';

const madhu = 'c4d3c265-d3bc-49c5-82eb-08c9926432e5', guest = '11111111-1111-4111-8111-111111111111';
const style = 'aaaaaaaa-0000-4000-8000-000000000001', project = 'aaaaaaaa-0000-4000-8000-000000000002';
const breakdown = 'aaaaaaaa-0000-4000-8000-000000000003', blockout = 'aaaaaaaa-0000-4000-8000-000000000004';
const run = 'aaaaaaaa-0000-4000-8000-000000000005', idea = 'aaaaaaaa-0000-4000-8000-000000000006';
const outside = 'bbbbbbbb-0000-4000-8000-000000000000';

test('the guest copy gets new ids everywhere and nothing left to claim', () => {
  const { rows, ids } = copyRows({
    creator_styles: [{ id: style, user_id: madhu, is_default: true }],
    creator_style_files: [{ style_id: style, user_id: madhu, path: 'DESIGN.md' }],
    projects: [{ id: project, user_id: madhu, style_id: style }],
    video_jobs: [
      { id: breakdown, user_id: madhu, project_id: project, status: 'done', input: {} },
      { id: blockout, user_id: madhu, project_id: project, status: 'queued', input: { breakdown_id: breakdown, ref: outside } },
    ],
    radar_runs: [{ id: run, user_id: madhu, status: 'running' }],
    radar_ideas: [{ id: idea, user_id: madhu, run_id: run }],
    plan_items: [{ id: 'aaaaaaaa-0000-4000-8000-000000000007', user_id: madhu, project_id: project, radar_idea_id: idea }],
  }, madhu, guest);

  const json = JSON.stringify(rows);
  for (const old of [madhu, style, project, breakdown, blockout, run, idea]) assert.ok(!json.includes(old), `${old} left in the copy`);
  assert.equal(rows.creator_style_files[0].style_id, rows.creator_styles[0].id);
  assert.equal(rows.creator_style_files[0].user_id, guest);
  assert.equal(rows.projects[0].style_id, ids.get(style));
  assert.deepEqual(rows.video_jobs[1].input, { breakdown_id: ids.get(breakdown), ref: outside });
  assert.equal(rows.video_jobs[0].status, 'done');
  assert.equal(rows.video_jobs[1].status, 'failed');
  assert.equal(rows.radar_runs[0].status, 'failed');
  assert.equal(rows.radar_ideas[0].run_id, rows.radar_runs[0].id);
  assert.equal(rows.plan_items[0].radar_idea_id, rows.radar_ideas[0].id);
  assert.equal(remapIds(`blockout/${blockout}/preview.mp4`, ids), `blockout/${ids.get(blockout)}/preview.mp4`);
});
