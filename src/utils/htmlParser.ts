/**
 * Cleans HTML entities and tags from a code block.
 * @param code - Raw HTML code block content
 * @returns Cleaned code string with HTML removed
 */
export const cleanCodeBlock = (code: string): string => {
  return code
    .replace(/<span class="[^"]*">/g, '')
    .replace(/<\/span>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .trim();
};

/**
 * Converts HTML text to Markdown format.
 * @param text - HTML text to convert
 * @returns Markdown-formatted text
 */
const cleanHtmlText = (text: string): string => {
  return text
    .replace(/<code class="[^"]*">(.*?)<\/code>/g, '`$1`')
    .replace(/<a href="([^"]*)">(.*?)<\/a>/g, '[$2]($1)')
    .replace(/<em>(.*?)<\/em>/g, '*$1*')
    .replace(/<strong>(.*?)<\/strong>/g, '**$1**')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Parses HTML from an api-linter rule documentation page.
 * Extracts details and examples sections and converts them to Markdown.
 * @param html - Raw HTML content from the rule documentation page
 * @returns Markdown-formatted documentation string
 */
export const parseRuleHtml = (html: string): string => {
  const detailsMatch = html.match(/<h2 id="details">Details<\/h2>\s*\n*\s*<p>(.*?)<\/p>/s);
  const examplesMatch = html.match(/<h2 id="examples">Examples<\/h2>(.*?)<h2/s);
  
  let markdown = '';
  
  if (detailsMatch) {
    const details = cleanHtmlText(detailsMatch[1]);
    markdown += `**Details:**\n${details}\n\n`;
  }
  
  if (examplesMatch) {
    const examplesSection = examplesMatch[1];
    const incorrectMatch = examplesSection.match(/<p><strong>Incorrect<\/strong>\s+code\s+for\s+this\s+rule:<\/p>\s*<div class="language-proto[^>]*><div class="highlight"><pre[^>]*><code>(.*?)<\/code>/s);
    const correctMatch = examplesSection.match(/<p><strong>Correct<\/strong>\s+code\s+for\s+this\s+rule:<\/p>\s*<div class="language-proto[^>]*><div class="highlight"><pre[^>]*><code>(.*?)<\/code>/s);
    
    if (incorrectMatch || correctMatch) {
      markdown += `---\n\n`;
      
      if (incorrectMatch) {
        const incorrectCode = cleanCodeBlock(incorrectMatch[1]);
        markdown += `#### Incorrect Example\n\n\`\`\`proto\n${incorrectCode}\n\`\`\`\n\n`;
      }
      
      if (correctMatch) {
        const correctCode = cleanCodeBlock(correctMatch[1]);
        markdown += `#### Correct Example\n\n\`\`\`proto\n${correctCode}\n\`\`\`\n\n`;
      }
    }
  }
  
  return markdown || `**Documentation available at the link below.**`;
};
