import type { ComponentProps } from 'react';
import { useRememberedBoolean } from '../hooks/useRememberedBoolean';

type Props = Omit<ComponentProps<'details'>, 'open'> & { rememberKey: string; defaultOpen?: boolean };
export function RememberedDetails({ rememberKey, defaultOpen = false, onToggle, onClick, ...props }: Props) {
  const [open, setOpen] = useRememberedBoolean(rememberKey, defaultOpen);
  return <details {...props} open={open} onClick={event => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || !(event.target instanceof Element)) return;
    const summary = event.target.closest('summary');
    if (summary?.parentElement !== event.currentTarget) return;
    const control = event.target.closest('button,a,input,select,textarea,[role="button"],[role="link"]');
    if (control && control !== summary) return;
    event.preventDefault(); setOpen(value => !value);
  }} onToggle={event => {
    if (event.target !== event.currentTarget) return;
    if (event.currentTarget.open !== open) setOpen(event.currentTarget.open);
    onToggle?.(event);
  }} />;
}
