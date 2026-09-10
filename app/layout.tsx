import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {title:'Pump Signal · 毕业币热度监控',description:'毕业币社交扩散、预算监控与长持型聪明钱包研究'};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="zh-CN"><body>{children}</body></html>}
