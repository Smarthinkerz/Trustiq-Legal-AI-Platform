import { Hono } from 'hono'

const brandingRoutes = new Hono()

let uploadedAssets: Record<string, string> = {}

brandingRoutes.post('/variables', async (c) => {
  const variables = await c.req.json()
  return c.json({ success: true, message: 'Brand variables saved successfully', data: variables })
})

brandingRoutes.post('/upload-logo', async (c) => {
  const formData = await c.req.formData()
  const logoFile = formData.get('logo') as File
  if (!logoFile) return c.json({ success: false, error: 'No logo file provided' }, 400)
  const assetId = `logo_${Date.now()}`
  uploadedAssets[assetId] = `data:${logoFile.type};base64,placeholder`
  return c.json({ success: true, message: 'Logo uploaded successfully', url: uploadedAssets[assetId], assetId })
})

brandingRoutes.post('/upload-watermark', async (c) => {
  const formData = await c.req.formData()
  const watermarkFile = formData.get('watermark') as File
  if (!watermarkFile) return c.json({ success: false, error: 'No watermark file provided' }, 400)
  const assetId = `watermark_${Date.now()}`
  uploadedAssets[assetId] = `data:${watermarkFile.type};base64,placeholder`
  return c.json({ success: true, message: 'Watermark uploaded successfully', url: uploadedAssets[assetId], assetId })
})

brandingRoutes.get('/assets', (c) => c.json({ success: true, assets: uploadedAssets }))

brandingRoutes.delete('/assets/:assetId', (c) => {
  const assetId = c.req.param('assetId')
  if (uploadedAssets[assetId]) {
    delete uploadedAssets[assetId]
    return c.json({ success: true, message: 'Asset deleted successfully' })
  }
  return c.json({ success: false, error: 'Asset not found' }, 404)
})

export default brandingRoutes
