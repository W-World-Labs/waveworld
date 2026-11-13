# tuanliu-agent binary

```bash
./bin/tuanliu-agent register --name my-gpu
./bin/tuanliu-agent run
./bin/tuanliu-agent submit --preset cylinder --steps 1000
./bin/tuanliu-agent probe
```

Dawn 原生库在 `bin/native/`（也可放在二进制同目录）。

环境变量：
- `TASK_API_URL` API 地址
- `AGENT_TOKEN` / `data/agent-token.json`
- `TUANLIU_ROOT` 项目根（含 public/models）
- `DAWN_NODE_PATH` 强制指定 .node 路径
