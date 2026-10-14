import { expect, test } from 'claude-code/testing'

const sourceOf = (minimum: number): string => {
  const rect = '<rect x="1" y="1" width="6" height="6" fill="#ff0000"/>'
  return '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="56" viewBox="0 0 18 14">' + rect.repeat(Math.ceil(minimum / rect.length)) + '</svg>'
}

for (const [name, sources, text, accepted] of [
  ['static image probe', ['<svg xmlns="http://www.w3.org/2000/svg" width="72" height="56" viewBox="0 0 18 14"><rect x="1" y="1" width="6" height="6" fill="#ff0000"/><rect x="11" y="8" width="6" height="5" fill="#00ff00"/></svg>'], '', true],
  ['one source over 100000', [sourceOf(110000)], '', true],
  ['multiple sources over 100000 together', [sourceOf(55000), sourceOf(55000)], '', true],
  ['sources and text over 100000 together', [sourceOf(55000), sourceOf(40000)], 'x'.repeat(10000), true],
  ['one source over 131072', [sourceOf(132000)], '', false],
] as const) {
  test(`SVG bounds: ${name}`, async ($, on) => {
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      if (e.surface !== 'desktop') return $.ui.resolve(e).Text({ children: '' })
      const { Box, Text, Svg } = $.ui.resolve(e)
      return Box({ children: [...sources.map(source => Svg({ source, alt: 'CrabBus SVG probe', width: 72, height: 56 })), Text({ children: text })] })
    })
    let error: unknown
    let ui
    try {
      ui = await $.ui.mount({ plugin: 'crabbus', surface: 'desktop', component: 'AbovePrompt', requestId: 'svg-probe', props: { bodyColumns: 120, maxRows: 10, hasSurvey: false, isWorking: false, scroll: { offset: 0, bodyRows: 10 }, view: {} } })
      await ui.drawn()
    } catch (e) { error = e }
    if (accepted) {
      expect(String(error ?? '')).toBe('')
      const pictures = await ui!.findAll({ type: 'Svg' })
      expect(pictures.length).toBe(sources.length)
      for (let i = 0; i < pictures.length; i++) {
        expect(pictures[i]?.props.source).toBe(sources[i])
        expect(pictures[i]?.props.alt).toBe('CrabBus SVG probe')
        expect(pictures[i]?.props.width).toBe(72)
        expect(pictures[i]?.props.height).toBe(56)
        expect(pictures[i]?.props.isInteractive).toBeUndefined()
      }
    } else {
      expect(error !== undefined).toBe(true)
      expect(String(error)).toMatch(/source|131072/)
    }
    if (ui) await ui.unmount()
  })
}
