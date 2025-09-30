import ReactMarkdown from 'react-markdown'
import './MarkdownMessage.css'

function MarkdownMessage({ content }) {
  return (
    <div className="markdown-content">
      <ReactMarkdown
        components={{
        // Customize paragraph rendering to add proper spacing
        p: ({ node, ...props }) => <p className="markdown-paragraph" {...props} />,

        // Bold text
        strong: ({ node, ...props }) => <strong className="markdown-bold" {...props} />,

        // Italic text
        em: ({ node, ...props }) => <em className="markdown-italic" {...props} />,

        // Lists
        ul: ({ node, ...props }) => <ul className="markdown-list" {...props} />,
        ol: ({ node, ...props }) => <ol className="markdown-list markdown-list-ordered" {...props} />,
        li: ({ node, ...props }) => <li className="markdown-list-item" {...props} />,

        // Links - open in new tab by default
        a: ({ node, ...props }) => (
          <a
            className="markdown-link"
            target="_blank"
            rel="noopener noreferrer"
            {...props}
          />
        ),

        // Code blocks
        code: ({ node, inline, ...props }) =>
          inline ? (
            <code className="markdown-code-inline" {...props} />
          ) : (
            <code className="markdown-code-block" {...props} />
          ),

        // Preformatted text
        pre: ({ node, ...props }) => <pre className="markdown-pre" {...props} />,

        // Headings
        h1: ({ node, ...props }) => <h1 className="markdown-heading markdown-h1" {...props} />,
        h2: ({ node, ...props }) => <h2 className="markdown-heading markdown-h2" {...props} />,
        h3: ({ node, ...props }) => <h3 className="markdown-heading markdown-h3" {...props} />,
        h4: ({ node, ...props }) => <h4 className="markdown-heading markdown-h4" {...props} />,

        // Blockquotes
        blockquote: ({ node, ...props }) => <blockquote className="markdown-blockquote" {...props} />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

export default MarkdownMessage