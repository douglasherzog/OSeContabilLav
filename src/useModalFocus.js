import { useEffect, useRef } from 'react';

export function useModalFocus(isOpen) {
  const ref = useRef(null);
  useEffect(() => {
    if (!isOpen) return;
    const id = setTimeout(() => {
      if (ref.current) ref.current.focus();
    }, 50);
    return () => clearTimeout(id);
  }, [isOpen]);
  return ref;
}
