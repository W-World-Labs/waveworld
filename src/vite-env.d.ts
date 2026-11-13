/// <reference types="vite/client" />
/// <reference types="@webgpu/types" />

declare module '*.json?compressed' {
  const data: any
  export default data
}
