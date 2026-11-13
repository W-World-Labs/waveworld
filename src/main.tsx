/*! Atlas SPA entry; Vite emits this module as /assets/index-*.js */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { LocaleProvider } from './lib/i18n'
import { router } from './router'
import './index.css'

document.documentElement.dataset.wwAtlas = '1'
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LocaleProvider>
      <RouterProvider router={router} />
    </LocaleProvider>
  </StrictMode>,
)
