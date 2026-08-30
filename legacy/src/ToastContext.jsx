import React, { createContext, useContext } from 'react';
import { useToast, ToastContainer } from './components/Toast';

const ToastCtx = createContext(null);

export function ToastProvider({ children }) {
  const { toasts, toast, remove } = useToast();
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <ToastContainer toasts={toasts} onRemove={remove} />
    </ToastCtx.Provider>
  );
}

export function useToastCtx() {
  return useContext(ToastCtx);
}
