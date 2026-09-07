import { mkdir, writeFile } from "fs/promises"

const TEAMS = {
    '2bfc6e58-485f-8006-9d07-fe360e067c6b': 'townsfolk',
    '2bfc6e58-485f-804b-a4f2-fe76108367bc': 'outsider',
    '2bfc6e58-485f-80b4-b28c-d3f87189b821': 'minion',
    '2bfc6e58-485f-8059-b37f-d6cffbccbf6c': 'demon',
    '2bfc6e58-485f-80d8-87ae-eb92d2bb40b3': 'traveller',
    '2bfc6e58-485f-8072-9a69-e77527250fcf': 'fabled',
    '2bfc6e58-485f-8048-884c-fa29f3dbe5d6': 'loric',
}

async function fetchDatabase(sourceId, name) {
    let results = [], hasMore = true, cursor = undefined, page = 1

    while (hasMore) {
        const data = await fetchPage(sourceId, cursor)
        console.log(`${name}: Got page #${page++}`)
        hasMore = data.has_more
        cursor = data.next_cursor
        results.push(...data.results)
    }

    return results
}

async function fetchPage(sourceId, start_cursor) {
    const res = await fetch(`https://api.notion.com/v1/data_sources/${sourceId}/query`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
            'Notion-Version': process.env.NOTION_VERSION,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            page_size: 100,
            start_cursor,
        }),
    })

    if (!res.ok) {
        const text = await res.text()
        throw new Error(`Notion API error ${res.status}: ${text}`)
    }

    return await res.json()
}

async function mapRoles(roles, jinxes) {
    const pageIdToRoleId = Object.fromEntries(
        roles.map(role => [role.id, plainText(role.properties['ID'].rich_text)])
    )

    const jinxesByRoleId = {}
    for (const jinx of jinxes) {
        const [first, second] = jinx.properties['Персонажи'].relation
        const reason = plainText(jinx.properties['Правило'].title)
        if (!first || !second) continue

        addJinx(jinxesByRoleId, pageIdToRoleId[first.id], pageIdToRoleId[second.id], reason)
        addJinx(jinxesByRoleId, pageIdToRoleId[second.id], pageIdToRoleId[first.id], reason)
    }

    const results = {}
    for (const role of roles) {
        const result = mapRole(role, jinxesByRoleId[pageIdToRoleId[role.id]])
        if (result) results[result.id] = result
    }

    await writeFile('roles.json', JSON.stringify(results, null, 2), { encoding: "utf8" })
    console.log(`roles.json saved with ${Object.keys(results).length} roles.`)
}

function addJinx(map, roleId, otherRoleId, reason) {
    if (!roleId || !otherRoleId) return
    (map[roleId] ??= []).push({ id: otherRoleId, reason })
}

function mapRole(role, jinxes) {
    const p = role.properties
    const id = plainText(p['ID'].rich_text)
    const team = TEAMS[p['Тип'].relation[0]?.id]
    if (!id) return null

    const result = {
        id,
        name: plainText(p['Название'].title),
        ability: plainText(p['Способность'].rich_text),
        image: `https://raw.githubusercontent.com/botc-ru/data/refs/heads/main/images/roles/${id}.png`,
    }
    if (team) result.team = team

    const flavor = plainText(p['Цитата'].rich_text)
    if (flavor) result.flavor = flavor

    const firstNight = p['Первая ночь порядок'].number
    if (firstNight != null) result.firstNight = firstNight

    const firstNightReminder = plainText(p['Первая ночь подсказка'].rich_text)
    if (firstNightReminder) result.firstNightReminder = firstNightReminder

    const otherNight = p['Другие ночи порядок'].number
    if (otherNight != null) result.otherNight = otherNight

    const otherNightReminder = plainText(p['Другие ночи подсказка'].rich_text)
    if (otherNightReminder) result.otherNightReminder = otherNightReminder

    const modifications = plainText(p['Замены'].rich_text)
    if (modifications) result.modifications = modifications

    if (jinxes?.length) result.jinxes = jinxes

    return result
}

function plainText(richText) {
    return richText.map(t => t.plain_text).join('')
}

async function fetchIcons(folder, json) {
    await mkdir(`images/${folder}`, { recursive: true })

    let done = 0
    await Promise.all(json.map(page => fetchIcon(folder, page, () => {
        done++
        if (done % 10 === 0) console.log(`${folder} icons: #${done}`)
    })))
}

async function fetchIcon(folder, page, onDone) {
    const url = page?.icon?.file?.url
    const name = page?.properties?.ID?.rich_text?.[0]?.plain_text ?? page?.id
    if (!url) return

    const res = await fetch(url)

    if (!res.ok) {
        console.error(`Failed to download icon for ${name}`)
        return
    }

    const arrayBuffer = await res.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    await writeFile(`images/${folder}/${name}.png`, buffer)
    onDone()
}

const [roles, jinxes] = await Promise.all([
    fetchDatabase(process.env.ROLES_DATABASE, 'roles'),
    fetchDatabase(process.env.JINXES_DATABASE, 'jinxes'),
])

await Promise.all([
    mapRoles(roles, jinxes),
    fetchIcons('roles', roles),
])
