require('dotenv').config()
const { connectMongo, getState, persistOne } = require('../src/store')

async function run() {
  await connectMongo()
  const state = await getState()

  // 1. Fix Sanil businessName
  const sanil = state.clients.find(c => c.id === 'CLI_N6RG0K')
  if (!sanil) { console.log('ERROR: Sanil client not found'); process.exit(1) }

  const fixedSanil = { ...sanil, businessName: 'Sanil Kumar Singh' }
  await persistOne('client', sanil.id, fixedSanil)
  console.log('✓ Sanil businessName fixed:', sanil.businessName, '→ Sanil Kumar Singh')

  // 2. Find Sanil contact in any client's portalContacts
  let sanilContact = null
  for (const cl of state.clients) {
    const found = (cl.portalContacts || []).find(x =>
      x.email === 'sanilkumarsingh714@gmail.com' ||
      x.refClientId === 'CLI_N6RG0K'
    )
    if (found) { sanilContact = found; break }
  }

  // 3. If no contact exists, find/create one linked to Sanil
  // Check all contacts across all clients
  let contactId = sanilContact?.id
  if (!sanilContact) {
    // Search by mobile too
    for (const cl of state.clients) {
      const found = (cl.portalContacts || []).find(x => x.mobile === '9628152344' || x.mobile === '9792565492')
      if (found) { sanilContact = found; contactId = found.id; break }
    }
  }

  console.log('Sanil contact found:', sanilContact?.id, '|', sanilContact?.name, '|', sanilContact?.email)

  // 4. Patch the existing meeting with clientContactId
  const tc = state.clients.find(c => c.id === 'CLI_KR65MZ')
  if (!tc) { console.log('ERROR: TC client not found'); process.exit(1) }

  const updatedMeetings = (tc.portalMeetings || []).map(m => {
    if (m.id !== 'MTG_KI8BRH') return m
    return {
      ...m,
      clientContactId: contactId || sanil.id,
      clientName: 'Sanil Kumar Singh',
      contactPerson: 'Sanil Kumar Singh',
    }
  })

  await persistOne('client', tc.id, { ...tc, portalMeetings: updatedMeetings })
  console.log('✓ Meeting MTG_KI8BRH patched with clientContactId:', contactId || sanil.id)

  // 5. Verify my-meetings logic
  const state2 = await getState()
  const sanil2 = state2.clients.find(c => c.id === 'CLI_N6RG0K')
  console.log('\n=== VERIFICATION ===')
  console.log('Sanil businessName:', sanil2?.businessName)

  const myContactIds = new Set()
  for (const cl of state2.clients) {
    for (const contact of (cl.portalContacts || [])) {
      if (
        contact.refClientId === 'CLI_N6RG0K' ||
        (contact.email && contact.email.toLowerCase() === 'sanilkumarsingh714@gmail.com')
      ) {
        myContactIds.add(contact.id)
        if (contact.businessId) myContactIds.add(contact.businessId)
        console.log('Matched contact:', contact.id, '| name:', contact.name, '| refClientId:', contact.refClientId)
      }
    }
  }
  // Also add sanil.id itself as fallback
  myContactIds.add('CLI_N6RG0K')

  const tc2 = state2.clients.find(c => c.id === 'CLI_KR65MZ')
  const mtg = (tc2?.portalMeetings || []).find(m => m.id === 'MTG_KI8BRH')
  console.log('Meeting clientContactId:', mtg?.clientContactId)
  console.log('myContactIds:', [...myContactIds])
  console.log('Match:', myContactIds.has(mtg?.clientContactId))

  process.exit(0)
}

run().catch(e => { console.error('Error:', e.message); process.exit(1) })
