import { Children, Fragment, createContext, isValidElement, useContext, useId, useLayoutEffect, type ReactNode } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { NativeMenuModel, type MenuEntry } from './nativeMenuModel';

export const NativeMenuContext = createContext<NativeMenuModel | null>(null);
const PathContext = createContext<number[]>([]);
export function useNativeMenuEntry(entry: Omit<MenuEntry, 'id'>, action?: () => void) {
  const model = useContext(NativeMenuContext), path = useContext(PathContext), id = useId();
  useLayoutEffect(() => { model?.register({ ...entry, id }, path, action); });
  useLayoutEffect(() => () => { model?.remove(id); }, [model, id]);
  return !!model;
}
function textContent(node: ReactNode): string {
  return Children.toArray(node).map(child => typeof child === 'string' || typeof child === 'number' ? String(child)
    : isValidElement<{ children?: ReactNode }>(child) ? textContent(child.props.children) : '').join('');
}
function Notice({ children }: { children: ReactNode }) {
  useNativeMenuEntry({ kind: 'row', label: textContent(children), disabled: true });
  return null;
}
// Render hook-owning actions normally. Only layout containers are flattened;
// callbacks and asynchronous download/playlist state remain in React.
export function NativeMenuContent({ children }: { children: ReactNode }) {
  const path = useContext(PathContext);
  return <>{Children.toArray(children).map((child, index) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return null;
    const content = child.type === Fragment || child.type === View ? <NativeMenuContent>{child.props.children}</NativeMenuContent>
      : child.type === Text ? <Notice>{child.props.children}</Notice>
      : child.type === ActivityIndicator ? <Notice>Operazione in corso…</Notice> : child;
    return <PathContext.Provider key={child.key ?? index} value={[...path, index]}>{content}</PathContext.Provider>;
  })}</>;
}
export function MenuGroup({ children }: { children: ReactNode }) {
  const native = useContext(NativeMenuContext);
  return native ? <NativeMenuContent>{children}</NativeMenuContent> : <>{children}</>;
}
