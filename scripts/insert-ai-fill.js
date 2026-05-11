const fs = require('fs')
const path = require('path')

const filePath = path.join(__dirname, '../src/routes/businessPortal.js')
let content = fs.readFileSync(filePath, 'utf8')

const aiEndpoint = `
// ── AI Auto-fill ─────────────────────────────────────────────────────────────
router.post('/ai-fill', async (req, res) => {
  const { prompt } = req.body || {}
  if (!prompt?.trim()) return res.status(400).json({ error: 'prompt is required' })
  const Groq = require('groq-sdk')
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
  const categories = ['Real Estate','Healthcare','Education','Retail','Restaurant / Food','IT / Software','Finance','Manufacturing','Logistics','Salon / Beauty','Gym / Fitness','Legal','Travel','Automobile','Other']
  const subCatMap = {
    'Real Estate':['Residential','Commercial','Plots','Rental'],
    'Healthcare':['Hospital','Clinic','Pharmacy','Lab'],
    'Education':['School','College','Coaching','Online'],
    'Retail':['Grocery','Fashion','Electronics','General'],
    'Restaurant / Food':['Restaurant','Cafe','Cloud Kitchen','Catering'],
    'IT / Software':['Web Dev','App Dev','SaaS','Agency'],
    'Finance':['CA','Insurance','Loans','Investment'],
    'Manufacturing':['FMCG','Industrial','Textile','Auto Parts'],
    'Logistics':['Transport','Courier','Warehouse'],
    'Salon / Beauty':['Salon','Spa','Makeup','Skincare'],
    'Gym / Fitness':['Gym','Yoga','Sports','Nutrition'],
    'Legal':['Advocate','Law Firm','Compliance'],
    'Travel':['Tour Operator','Hotel','Visa','Cab'],
    'Automobile':['Showroom','Service Center','Spare Parts'],
    'Other':['Other'],
  }
  const systemPrompt = \`You are a business data extraction assistant for an Indian CRM.
Extract structured business info from user input and return ONLY valid JSON.
Categories: \${categories.join(', ')}
Sub-categories: \${JSON.stringify(subCatMap)}
Business types: Proprietorship, Partnership, Pvt Ltd, LLP, Other
MBC type: client or server
MBC sub-category: Startup - Inhouse, Startup - Outside, MSME, Big Enterprise, PSU, Others
Return ONLY this JSON (empty string if unknown):
{"name":"","company":"","businessType":"","category":"","subCategory":"","email":"","mobile":"","alternateMobile":"","websiteUrl":"","gstNumber":"","panNumber":"","address":"","city":"","state":"","pincode":"","country":"India","instagramUrl":"","facebookUrl":"","youtubeUrl":"","type":"client","mbcSubCategory":"","status":"active","notes":""}
Return ONLY the JSON, no explanation.\`
  try {
    const completion = await groq.chat.completions.create({
      model: 'llama3-8b-8192',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt.trim() },
      ],
      temperature: 0.2,
      max_tokens: 1024,
    })
    const text = completion.choices[0]?.message?.content || '{}'
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return res.status(422).json({ error: 'Could not parse AI response' })
    const data = JSON.parse(jsonMatch[0])
    res.json({ data })
  } catch (err) {
    console.error('[AI Fill]', err?.message)
    res.status(500).json({ error: err?.message || 'AI fill failed' })
  }
})

`

// Insert after the presigned-url route closing
const marker = "res.status(500).json({ error: err.message || 'Failed to generate URL' })\n  }\n})"
const idx = content.indexOf(marker)
if (idx === -1) { console.error('Marker not found'); process.exit(1) }

const insertAt = idx + marker.length
content = content.slice(0, insertAt) + '\n' + aiEndpoint + content.slice(insertAt)
fs.writeFileSync(filePath, content)
console.log('AI fill endpoint inserted at index', insertAt)
