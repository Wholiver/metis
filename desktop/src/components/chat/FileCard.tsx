import React from 'react';
import { AttachmentFile } from '../../types';
import ContextCards from '../primitives/ContextCards';

interface FileCardProps {
  file: AttachmentFile;
  onOpen?: () => void;
}

export const FileCard: React.FC<FileCardProps> = ({ file, onOpen }) => {
  return (
    <ContextCards
      className="my-1 max-w-[320px]"
      items={[{
        id: file.name,
        title: file.name,
        description: file.pagesText,
        meta: file.sizeText,
      }]}
      onOpen={onOpen ? () => onOpen() : undefined}
    />
  );
};
