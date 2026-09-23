import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { EventCard } from './cards'

describe('DecisionCard', () => {
	it('shows the chosen action and keeps the complete candidate list collapsed', () => {
		const html = renderToStaticMarkup(
			createElement(EventCard, {
				event: {
					type: 'decision',
					kind: 'action',
					selectedLabel: 'click Like',
					selectedOptionId: 'b',
					candidateCount: 2,
					choices: [
						{ id: 'a', label: 'click Subscribe' },
						{ id: 'b', label: 'click Like' },
					],
				},
			})
		)
		expect(html).toContain('Next action')
		expect(html).toContain('Choices considered (2)')
		expect(html).toContain('<details')
		expect(html).not.toContain('<details open')
		expect(html).toContain('click Subscribe')
		expect(html).toContain('click Like')
	})
})
