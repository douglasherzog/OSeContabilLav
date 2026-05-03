import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * Componente Modal padronizado e interativo
 * Resolve problemas de campos não clicáveis em modais
 */
export default function Modal({ 
  isOpen, 
  onClose, 
  title, 
  subtitle, 
  children, 
  footer,
  className = '',
  maxWidth = 'max-w-sm'
}) {
  const modalRef = useRef(null);
  const overlayRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      // Bloquear scroll do body
      document.body.style.overflow = 'hidden';
      
      // Focar no modal
      setTimeout(() => {
        modalRef.current?.focus();
      }, 50);
    } else {
      // Restaurar scroll do body
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Fechar ao pressionar Escape
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // Fechar ao clicar no overlay
  const handleOverlayClick = (e) => {
    if (e.target === overlayRef.current) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div 
      ref={overlayRef}
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={handleOverlayClick}
    >
      <div 
        ref={modalRef}
        className={`bg-white rounded-2xl shadow-xl w-full ${maxWidth} p-6 ${className}`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            {title && <h2 className="text-lg font-bold">{title}</h2>}
            {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
          </div>
          <button 
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Fechar"
          >
            <X size={20} />
          </button>
        </div>
        
        <div className="space-y-3">
          {children}
        </div>
        
        {footer && (
          <div className="flex gap-2 justify-end pt-4 border-t">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
