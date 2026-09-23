import type { PageObservation } from '@page-agent/browser'

/** Persistent visual feedback for the document-local browser session. */
export class ObservationOverlay {
	private root: HTMLDivElement | undefined
	private readonly boxes = new Map<string, HTMLDivElement>()

	update(observation: PageObservation): void {
		const root = this.root ?? this.createRoot()
		const visible = new Set<string>()
		for (const element of observation.elements) {
			const bounds = element.bounds
			if (
				!element.visible ||
				!element.enabled ||
				!bounds ||
				!element.supportedActions?.some((action) =>
					['click', 'input', 'select'].includes(action)
				) ||
				bounds.width <= 0 ||
				bounds.height <= 0 ||
				bounds.x + bounds.width < 0 ||
				bounds.y + bounds.height < 0 ||
				bounds.x > window.innerWidth ||
				bounds.y > window.innerHeight
			)
				continue

			const id = element.ref.localId
			visible.add(id)
			let box = this.boxes.get(id)
			if (!box) {
				box = document.createElement('div')
				box.style.cssText =
					'position:fixed;box-sizing:border-box;border:1px solid rgba(92,145,255,.7);background:rgba(92,145,255,.035);border-radius:3px;'
				root.appendChild(box)
				this.boxes.set(id, box)
			}
			box.style.left = `${bounds.x}px`
			box.style.top = `${bounds.y}px`
			box.style.width = `${bounds.width}px`
			box.style.height = `${bounds.height}px`
		}
		for (const [id, box] of this.boxes) {
			if (visible.has(id)) continue
			box.remove()
			this.boxes.delete(id)
		}
	}

	dispose(): void {
		this.root?.remove()
		this.root = undefined
		this.boxes.clear()
	}

	private createRoot(): HTMLDivElement {
		const root = document.createElement('div')
		root.dataset.pageAgentIgnore = 'true'
		root.dataset.browserUseIgnore = 'true'
		root.style.cssText =
			'position:fixed;inset:0;z-index:2147483640;pointer-events:none;overflow:hidden;'
		document.body.appendChild(root)
		this.root = root
		return root
	}
}
