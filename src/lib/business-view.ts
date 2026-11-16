import { writeDisclosure } from './disclosure-state';

export const businessViewKey = (workspaceId: string, orderId: string, field: string) => `workspace:${workspaceId}:business-view:${orderId || 'home'}:${field}`;
export function focusBusinessView(workspaceId: string, orderId: string, tab: 'files' | 'feedback' | 'finance' | 'listing' | 'metrics') {
  writeDisclosure(businessViewKey(workspaceId, orderId, 'stage'), 'delivery');
  writeDisclosure(businessViewKey(workspaceId, orderId, 'tab'), tab);
}
