import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertWorkbenchDurationSeconds,
  describeRunTimes,
  formatRunTimeSeconds,
  labExecutionHeadline,
} from './run-times';

test('the workbench rejects durations under 10 s and accepts 10 s', () => {
  for (const durationSeconds of [9.999, 9, 1, 0, -1, NaN, Infinity, -Infinity]) {
    assert.throws(() => assertWorkbenchDurationSeconds(durationSeconds), /工作台仿真物理时长至少为 10 秒/);
  }
  assert.equal(assertWorkbenchDurationSeconds(10), 10);
  assert.equal(assertWorkbenchDurationSeconds(25), 25);
});

test('playback frame time is not treated as completed duration or a finished 10 s run', () => {
  const dt = 0.0008922597979972401;
  const times = describeRunTimes({
    dt,
    targetSeconds: 10,
    frameStep: 3,
    completedSteps: 11208,
    requestedSteps: 11208,
    status: 'succeeded',
  });
  assert.equal(times.framePhysicalSeconds, 3 * dt);
  assert.ok(Math.abs(times.framePhysicalSeconds! - 0.002676779) < 1e-9);
  assert.equal(times.completedPhysicalSeconds, 11208 * dt);
  assert.ok(times.completedPhysicalSeconds! >= 10);
  assert.notEqual(times.framePhysicalSeconds, times.completedPhysicalSeconds);
  assert.equal(times.targetPhysicalSeconds, 10);
  assert.equal(times.reachedTarget, true);
  assert.equal(times.markedComplete, true);
  assert.equal(times.shortResult, false);
  assert.equal(times.progressRatio, (11208 * dt) / 10);
  assert.match(labExecutionHeadline('succeeded', times), /计算完成 · 最终已计算时间/);
  assert.doesNotMatch(labExecutionHeadline('succeeded', times), /当前帧/);
});

test('cancelled, failed, and old short results are not marked as a completed 10 s run', () => {
  const dt = 0.0008922597979972401;
  const cancelled = describeRunTimes({
    dt, targetSeconds: 10, frameStep: 237, completedSteps: 237, requestedSteps: 11208, status: 'canceled',
  });
  assert.equal(cancelled.framePhysicalSeconds, 237 * dt);
  assert.ok(cancelled.completedPhysicalSeconds! < 1);
  assert.equal(cancelled.markedComplete, false);
  assert.equal(cancelled.shortResult, false);
  assert.match(labExecutionHeadline('canceled', cancelled), /任务已停止，未完成目标时间/);

  const failed = describeRunTimes({
    dt, targetSeconds: 10, completedSteps: 20, requestedSteps: 11208, status: 'failed',
  });
  assert.equal(failed.markedComplete, false);
  assert.match(labExecutionHeadline('failed', failed), /任务未完成/);

  const short = describeRunTimes({
    dt, targetSeconds: 10, frameStep: 3, completedSteps: 20, requestedSteps: 20, status: 'idle',
  });
  assert.equal(short.reachedTarget, false);
  assert.equal(short.markedComplete, false);
  const shortSucceeded = describeRunTimes({
    dt, targetSeconds: 10, frameStep: 3, completedSteps: 20, requestedSteps: 20, status: 'succeeded',
  });
  assert.equal(shortSucceeded.markedComplete, false);
  assert.match(labExecutionHeadline('succeeded', shortSucceeded), /计算未达到目标时间/);
  assert.equal(short.shortResult, true);
  assert.ok(short.completedPhysicalSeconds! < 0.02);
  assert.notEqual(short.framePhysicalSeconds, short.completedPhysicalSeconds);
  assert.match(labExecutionHeadline('idle', short), /已恢复短结果，未完成目标时间/);
  assert.equal(formatRunTimeSeconds(short.framePhysicalSeconds), String(Number((3 * dt).toPrecision(8))));
});

test('Host-completed work with locally cancelled result loading is described without claiming loaded results', () => {
  const headline = labExecutionHeadline('host-completed-local-canceled', null);
  assert.match(headline, /Host 任务已完成/);
  assert.match(headline, /本机已停止读取结果/);
  assert.match(headline, /计算结果未载入/);
  assert.doesNotMatch(headline, /任务已停止，未完成目标时间|计算完成 · 最终已计算时间/);
});
