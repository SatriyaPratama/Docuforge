import type { Metadata } from 'next';
import './globals.css';
import { AppProvider } from '@/context/AppContext';
import { BatchProvider } from '@/context/BatchContext';

export const metadata: Metadata = {
  title: 'DocuForge — AI Document Parser',
  description:
    'Upload PDFs to extract structured content — text, tables, and figures — powered by AI OCR.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col">
        <AppProvider><BatchProvider>{children}</BatchProvider></AppProvider>
      </body>
    </html>
  );
}
