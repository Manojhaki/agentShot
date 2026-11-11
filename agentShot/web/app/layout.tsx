export const metadata = {
  title: "AgentShot",
  description: "An agentic ecommerce demo powered by MCP agents",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
