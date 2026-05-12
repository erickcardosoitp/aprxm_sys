export function ArticleWrapper({ children }: { children: React.ReactNode }) {
  return <article className="prose prose-sm max-w-none">{children}</article>
}
