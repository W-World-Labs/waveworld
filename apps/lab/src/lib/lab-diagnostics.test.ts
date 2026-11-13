import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildClientDiagnosticReport,
  buildLabEvidenceArtifact,
  classifyGpuFailure,
  clearRecentLabLocalEvents,
  formatDiagnosticCode,
  getLabBuildId,
  recordLabLocalEvent,
} from './lab-diagnostics.ts';

describe('lab-diagnostics', () => {
  it('formatDiagnosticCode is stable and copy-safe', () => {
    const code = formatDiagnosticCode('webgpu_unavailable', 'abc123def456ghi');
    assert.match(code, /^lab-abc123def456-webgpu_unavailable$/);
    assert.equal(code.includes(' '), false);
  });

  it('getLabBuildId returns non-empty string', () => {
    assert.ok(getLabBuildId().length > 0);
  });

  it('classifies WebGPU unavailable as recoverable', () => {
    const f = classifyGpuFailure('当前浏览器不支持 WebGPU');
    assert.equal(f.kind, 'webgpu_unavailable');
    assert.equal(f.recoverable, true);
    assert.equal(f.code, 'webgpu_unavailable');
  });

  it('classifies device lost as context_lost', () => {
    const f = classifyGpuFailure('GPU 设备丢失: Device lost testing');
    assert.equal(f.kind, 'context_lost');
    assert.equal(f.code, 'context_lost');
    assert.equal(f.recoverable, true);
  });

  it('classifies generic GPU message', () => {
    const f = classifyGpuFailure('WebGPU 错误: validation failed');
    assert.equal(f.kind, 'gpu_error');
    assert.equal(f.recoverable, true);
  });

  it('buildLabEvidenceArtifact separates console and pageerror', () => {
    const art = buildLabEvidenceArtifact({
      suite: 'models-d',
      ok: false,
      steps: ['load', 'prepare'],
      failures: ['webgpu_unavailable'],
      events: [
        { type: 'console', message: 'warn', ts: 't0' },
        { type: 'pageerror', message: 'boom', ts: 't1' },
        { type: 'requestfailed', message: 'net', ts: 't2' },
      ],
    });
    assert.equal(art.ok, false);
    assert.equal(art.console.length, 1);
    assert.equal(art.pageerror.length, 1);
    assert.equal(art.requestfailed.length, 1);
    assert.match(art.diagnosticCode, /^lab-/);
    assert.ok(art.generatedAt);
  });

  it('buildClientDiagnosticReport includes build and recent local events', () => {
    clearRecentLabLocalEvents();
    recordLabLocalEvent('local_error', '当前浏览器不支持 WebGPU');
    const report = buildClientDiagnosticReport({
      activeModelId: 'naca0012',
      activeModelName: 'NACA 0012',
      webgpuSupported: false,
      gpuError: '当前浏览器不支持 WebGPU',
      userAgent: 'TestAgent/1.0',
      href: 'https://example.test/app/lab/lab',
      language: 'zh-CN',
    });
    assert.match(report, /WaveWorld Lab 诊断报告/);
    assert.match(report, /诊断码: `lab-/);
    assert.match(report, /naca0012/);
    assert.match(report, /webgpu_unavailable|不支持 WebGPU/);
    assert.match(report, /TestAgent\/1\.0/);
    assert.match(report, /issues\/49/);
    clearRecentLabLocalEvents();
  });
});
