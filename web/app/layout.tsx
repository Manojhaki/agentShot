export const metadata = {
  title: "AgentShot",
  description: "Find your next favorite with a local AI shopping assistant, a saved cart, and reviewed demo checkout.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
