#!/usr/bin/env python3
"""Opt-in real lifecycle smoke on the registered disposable 127.0.0.1:55470 listener."""
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import tempfile
import time
import urllib.request

root = Path(__file__).resolve().parents[2]
compute = root.parent / '00-24-w-compute'
binary = compute / 'target/x86_64-unknown-linux-musl/release/w-compute'
base = 'http://127.0.0.1:55470'
with socket.socket() as probe:
    if probe.connect_ex(('127.0.0.1', 55470)) == 0:
        raise SystemExit('Registered acceptance port is in use; refusing to disturb its owner')
work = Path(tempfile.mkdtemp(prefix='native-compute-', dir=root / '.runtime'))
os.chmod(work, 0o700)
processes, node_ids = [], []
session = None


def command(args, **kwargs):
    return subprocess.run([str(a) for a in args], check=True, text=True, capture_output=True, **kwargs).stdout.strip()


def api(path, method='GET', data=None):
    headers = {'Content-Type': 'application/json'}
    if session:
        headers['Authorization'] = 'Bearer ' + session
    request = urllib.request.Request(base + path, method=method, headers=headers, data=None if data is None else json.dumps(data).encode())
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read()
        return json.loads(raw) if raw else None


def launch(args, name):
    log = work / (name + '.log')
    with log.open('ab') as output:
        os.chmod(log, 0o600)
        process = subprocess.Popen([str(a) for a in args], stdout=output, stderr=output, start_new_session=True)
    processes.append(process)


def wait(check, seconds=30):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if any(process.poll() is not None for process in processes):
            raise RuntimeError('Acceptance process exited; inspect private logs at ' + str(work))
        try:
            if check():
                return
        except OSError:
            pass
        time.sleep(0.5)
    raise RuntimeError('Acceptance condition timed out')


try:
    command(['w-cli', 'assert-static-bin', binary])
    image = command(['docker', 'image', 'inspect', '--format', '{{.Id}}', 'waveworld-native:0.1.0'])
    template = {'id': 'waveworld-native', 'name': 'WaveWorld Rust native', 'description': 'Static CPU wave, heat and thermal wind executor', 'image': image,
                'command': ['/usr/local/bin/waveworld-agent', 'capabilities'], 'visibility': 'public',
                'min_memory_mib': 128, 'recommended_memory_mib': 512}
    (work / 'templates.json').write_text(json.dumps([template]))
    database = work / 'compute.db'
    command([binary, 'user', '--database', database, '--user', 'native-acceptance', '--name', 'Native acceptance', '--token-file', work / 'login.json'])
    session = json.loads((work / 'login.json').read_text())['token']
    launch([binary, 'server', '--database', database, '--templates', work / 'templates.json'], 'control')
    wait(lambda: api('/health')['status'] == 'ok')
    cluster = api('/api/clusters', 'POST', {'name': 'WaveWorld native acceptance'})['id']
    invitation = api(f'/api/clusters/{cluster}/invitations', 'POST', {'kind': 'node'})['token']
    config = work / 'node.json'
    command([binary, 'enroll', '--server', base, '--config', config, '--name', 'Native CPU acceptance', '--cpu-millis', '1000', '--memory-mib', '1024'], input=invitation + '\n')
    node_ids.append(json.loads(config.read_text())['node_id'])
    launch([binary, 'agent', '--config', config], 'node')
    wait(lambda: any(n['online'] and n['node']['file_transfer_version'] == 1 for n in api(f'/api/clusters/{cluster}/nodes')))
    credential = api('/api/access-tokens', 'POST', {'name': 'WaveWorld native acceptance', 'cluster_id': cluster, 'expires_in_days': 1})
    environment = {**os.environ, 'TASK_DB_PATH': str(work / 'host.db'), 'ARTIFACT_ROOT': str(work / 'artifacts'),
                   'W_COMPUTE_ENABLED': '1', 'W_COMPUTE_API_URL': base, 'W_COMPUTE_CLUSTER_ID': cluster,
                   'W_COMPUTE_TOKEN': credential['token'], 'W_COMPUTE_TEMPLATE_ID': template['id'],
                   'W_COMPUTE_ACCEPTANCE_PROOF': str(work / 'proof.json'), 'W_COMPUTE_ACCEPTANCE_STATE': str(work / 'recovery.json'),
                   'NODE_PATH': str(root / 'apps/host/node_modules')}
    subprocess.run([root / 'node_modules/.bin/tsx', '--tsconfig', root / 'apps/host/tsconfig.json', root / 'scripts/ci/w-compute-e2e.ts', '--allocate-only'], cwd=root, env=environment, check=True, timeout=90)
    subprocess.run([root / 'node_modules/.bin/tsx', '--tsconfig', root / 'apps/host/tsconfig.json', root / 'scripts/ci/w-compute-e2e.ts'], cwd=root, env=environment, check=True, timeout=600)
    proof = json.loads((work / 'proof.json').read_text())
    for item in proof['instances']:
        instance = api('/api/instances/' + item['instanceId'])
        name = 'wc-' + instance['node_id'] + '-' + instance['id']
        details = json.loads(command(['docker', 'inspect', name]))[0]
        assert details['HostConfig']['NetworkMode'] == 'none'
        assert details['HostConfig']['ReadonlyRootfs'] is True
        assert details['Config']['User'] == '1000:1000'
        assert not details['State']['Running']
        assert any(m['Destination'] == '/w-workspace' and m['Type'] == 'volume' for m in details['Mounts'])
        api('/api/instances/' + item['instanceId'] + '/actions', 'POST', {'action': 'delete', 'confirm': item['instanceId']})
        wait(lambda: api('/api/instances/' + item['instanceId'])['state'] == 'deleted')
    api('/api/access-tokens/' + credential['id'], 'DELETE')
    proof['networkNone'] = proof['nonRoot'] = proof['privateVolumeRetainedAfterStop'] = True
    (work / 'proof.json').write_text(json.dumps(proof, indent=2))
    print('PASS real Docker isolation and explicit cleanup; proof:', work / 'proof.json', flush=True)
finally:
    for process in reversed(processes):
        if process.poll() is None:
            process.send_signal(signal.SIGINT)
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
    for node in node_ids:
        containers = command(['docker', 'ps', '-aq', '--filter', 'label=com.w.compute.node=' + node]).splitlines()
        if containers:
            command(['docker', 'rm', '-f', *containers])
        volumes = command(['docker', 'volume', 'ls', '-q', '--filter', 'label=com.w.compute.node=' + node]).splitlines()
        if volumes:
            command(['docker', 'volume', 'rm', *volumes])
        assert not command(['docker', 'ps', '-aq', '--filter', 'label=com.w.compute.node=' + node])
        assert not command(['docker', 'volume', 'ls', '-q', '--filter', 'label=com.w.compute.node=' + node])
    if (work / 'proof.json').exists():
        proof = json.loads((work / 'proof.json').read_text()); proof['runtimeCleaned'] = True
        (work / 'proof.json').write_text(json.dumps(proof, indent=2))
