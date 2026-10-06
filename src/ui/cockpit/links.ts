// Where an item's page lives, for "Open in …" links.
export const linkTarget = (url: string) => (url.includes('dev.azure.com') ? 'ADO' : 'Notion')

export const notionPageUrl = (id: string) => `https://app.notion.com/p/${id.replace(/-/g, '')}`
