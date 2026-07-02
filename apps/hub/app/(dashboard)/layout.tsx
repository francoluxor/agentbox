import type { ReactNode } from 'react';
import { HubShell } from '@/components/hub-shell';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <HubShell>{children}</HubShell>;
}
