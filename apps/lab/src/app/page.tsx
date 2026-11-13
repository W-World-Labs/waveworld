'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useProjectStore, createProject } from '@/lib/stores/project-store';
import { listProjects, deleteProject as deleteStoredProject } from '@/lib/storage/project-storage';
import { Wind, Upload, FolderOpen, Plus, ArrowRight, Trash2, Clock } from 'lucide-react';

export default function HomePage() {
  const router = useRouter();
  const { projects, setCurrentProject, setProjects, deleteProject } = useProjectStore();
  const [storageError, setStorageError] = useState<string | null>(null);
  useEffect(() => {
    let canceled = false;
    void listProjects().then(projects => { if (!canceled) setProjects(projects); })
      .catch(error => { if (!canceled) setStorageError(`读取项目失败：${String(error)}`); });
    return () => { canceled = true; };
  }, [setProjects]);

  const handleNewProject = () => {
    const newProject = createProject('新风洞试验');
    setCurrentProject(newProject);
    router.push('/lab');
  };

  const handleOpenProject = (projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    if (project) {
      setCurrentProject(project);
      router.push('/lab');
    }
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-950/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
              <Wind className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Web Wind Tunnel</h1>
              <p className="text-xs text-zinc-400">基于 WebGPU 的 CFD 风洞实验室</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/jobs"
              className="text-sm text-zinc-300 hover:text-white px-3 py-2 rounded-lg border border-zinc-700 hover:bg-zinc-800"
            >
              Agent 任务
            </Link>
            <Link
              href="/import/fem"
              className="text-sm text-cyan-300 hover:text-cyan-200 px-3 py-2 rounded-lg border border-cyan-900 hover:bg-cyan-950/40"
            >
              结构工程导入
            </Link>
            <Button
              onClick={handleNewProject}
              className="bg-cyan-600 hover:bg-cyan-700 text-white"
            >
              <Plus className="w-4 h-4 mr-2" />
              新建试验
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-6 py-12">
        {storageError && <p role="alert" className="mb-4 text-sm text-amber-300">{storageError}</p>}
        {/* Hero Section */}
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-white mb-4">
            交互式风洞实验室
          </h2>
          <p className="text-lg text-zinc-400 max-w-2xl mx-auto mb-8">
            上传 3D 模型，设置风洞参数，实时运行 CFD 求解器，
            通过 WebGPU 加速的可视化分析流场特性
          </p>
          <div className="flex items-center justify-center gap-4">
            <Button
              size="lg"
              onClick={handleNewProject}
              className="bg-cyan-600 hover:bg-cyan-700 text-white px-8"
            >
              <Upload className="w-5 h-5 mr-2" />
              开始新风洞试验
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              onClick={() => router.push('/lab?demo=true')}
            >
              <Wind className="w-5 h-5 mr-2" />
              查看演示
            </Button>
          </div>
        </div>

        {/* Features */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-16">
          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardHeader>
              <div className="w-12 h-12 rounded-lg bg-cyan-500/10 flex items-center justify-center mb-4">
                <Upload className="w-6 h-6 text-cyan-400" />
              </div>
              <CardTitle className="text-white">模型上传</CardTitle>
              <CardDescription className="text-zinc-400">
                支持 STL、OBJ、glTF 格式的 3D 模型
              </CardDescription>
            </CardHeader>
          </Card>
          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardHeader>
              <div className="w-12 h-12 rounded-lg bg-blue-500/10 flex items-center justify-center mb-4">
                <Wind className="w-6 h-6 text-blue-400" />
              </div>
              <CardTitle className="text-white">实时求解</CardTitle>
              <CardDescription className="text-zinc-400">
                WebGPU 加速的 LBM / Navier-Stokes 求解器
              </CardDescription>
            </CardHeader>
          </Card>
          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardHeader>
              <div className="w-12 h-12 rounded-lg bg-purple-500/10 flex items-center justify-center mb-4">
                <ArrowRight className="w-6 h-6 text-purple-400" />
              </div>
              <CardTitle className="text-white">可视化分析</CardTitle>
              <CardDescription className="text-zinc-400">
                速度场、压力场、涡量、流线实时渲染
              </CardDescription>
            </CardHeader>
          </Card>
          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardHeader>
              <div className="w-12 h-12 rounded-lg bg-amber-500/10 flex items-center justify-center mb-4">
                <FolderOpen className="w-6 h-6 text-amber-300" />
              </div>
              <CardTitle className="text-white">结构工程导入</CardTitle>
              <CardDescription className="text-zinc-400">
                导入 Abaqus / CalculiX 多文件 .inp 工程，查看兼容诊断并导出结构 JobSpec
              </CardDescription>
            </CardHeader>
            <CardFooter>
              <Link href="/import/fem" className="text-sm text-cyan-300 underline">打开导入器</Link>
            </CardFooter>
          </Card>
        </div>

        {/* Recent Projects */}
        <div>
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-2xl font-bold text-white flex items-center gap-2">
              <FolderOpen className="w-6 h-6" />
              最近项目
            </h3>
            <Badge variant="secondary" className="bg-zinc-800 text-zinc-300">
              {projects.length} 个项目
            </Badge>
          </div>

          {projects.length === 0 ? (
            <Card className="bg-zinc-900/50 border-zinc-800 border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-16">
                <Wind className="w-16 h-16 text-zinc-700 mb-4" />
                <p className="text-zinc-400 text-lg mb-2">还没有项目</p>
                <p className="text-zinc-500 text-sm mb-6">
                  创建你的第一个风洞试验项目
                </p>
                <Button
                  onClick={handleNewProject}
                  className="bg-cyan-600 hover:bg-cyan-700"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  新建项目
                </Button>
              </CardContent>
            </Card>
          ) : (
            <ScrollArea className="h-[400px]">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {projects.map((project) => (
                  <Card
                    key={project.id}
                    className="bg-zinc-900/50 border-zinc-800 hover:border-zinc-700 transition-colors cursor-pointer group"
                    onClick={() => handleOpenProject(project.id)}
                  >
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <CardTitle className="text-white text-lg group-hover:text-cyan-400 transition-colors">
                            {project.name}
                          </CardTitle>
                          <CardDescription className="text-zinc-500 text-sm mt-1">
                            {project.description || '无描述'}
                          </CardDescription>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-zinc-400 hover:text-red-400"
                          onClick={(e) => {
                            e.stopPropagation();
                            void deleteStoredProject(project.id).then(() => deleteProject(project.id))
                              .catch(error => setStorageError(`删除项目失败：${String(error)}`));
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardFooter className="text-zinc-500 text-sm flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      {formatDate(project.updatedAt)}
                    </CardFooter>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800 mt-20">
        <div className="container mx-auto px-6 py-8 text-center text-zinc-500 text-sm">
          <p>Web Wind Tunnel Lab - 基于 Next.js 16 + React 19 + WebGPU</p>
        </div>
      </footer>
    </div>
  );
}
