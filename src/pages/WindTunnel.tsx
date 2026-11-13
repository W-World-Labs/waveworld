import { Navigate, useSearchParams } from 'react-router-dom'
import { TuanliuLab } from './TuanliuLab'

export function WindTunnel() {
  const [params] = useSearchParams()
  return params.get('legacy') === '1' ? <Navigate to="/fluid?preset=cylinder" replace /> : <TuanliuLab />
}
