type SEOProps = {
  title?: string;
  description?: string;
  image?: string;
  article?: boolean;
};

export default function SEO({ 
  title = "Divesh's Blog",
  description = "Thoughts on software engineering, web development, and technology",
  image = "/og-default.png",  // We'll create this default image later
  article = false 
}: SEOProps) {
  const siteUrl = "https://divesh.gg";  // Your domain

  return (
    <>
      <title>{title}</title>
      <meta name="description" content={description} />
      
      {/* Open Graph / Facebook */}
      <meta property="og:type" content={article ? "article" : "website"} />
      <meta property="og:url" content={siteUrl} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={`${siteUrl}${image}`} />

      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:url" content={siteUrl} />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={`${siteUrl}${image}`} />
    </>
  );
} 