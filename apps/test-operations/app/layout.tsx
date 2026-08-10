import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'QA/4HANA Test Operations',
  description: 'QA/4HANA test coverage, execution health, and immutable failure history.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
