// ======= type guards =======
// @note instanceof fails for elements inside iframes

export function isHTMLElement(el: unknown): el is HTMLElement {
	// @todo either specify to HTMLElement or allow Element here.
	return !!el && (el as Node).nodeType === 1
}

export function isInputElement(el: Element): el is HTMLInputElement {
	return el?.nodeType === 1 && el.tagName === 'INPUT'
}

export function isTextAreaElement(el: Element): el is HTMLTextAreaElement {
	return el?.nodeType === 1 && el.tagName === 'TEXTAREA'
}

const nonTextInputTypes = new Set([
	'button',
	'checkbox',
	'color',
	'file',
	'hidden',
	'image',
	'radio',
	'range',
	'reset',
	'submit',
])

export function isEditableTextElement(el: Element): boolean {
	if (isTextAreaElement(el)) return !el.disabled && !el.readOnly
	if (isInputElement(el)) {
		return !el.disabled && !el.readOnly && !nonTextInputTypes.has(el.type.toLowerCase())
	}
	return isHTMLElement(el) && el.isContentEditable
}

export function isSelectElement(el: Element): el is HTMLSelectElement {
	return el?.nodeType === 1 && el.tagName === 'SELECT'
}

export function isAnchorElement(el: Element): el is HTMLAnchorElement {
	return el?.nodeType === 1 && el.tagName === 'A'
}

// ======= iframe helpers =======

/** Iframe offset for translating element coordinates to top-frame viewport. */
export function getIframeOffset(element: HTMLElement): { x: number; y: number } {
	const frame = element.ownerDocument.defaultView?.frameElement as HTMLElement | null
	if (!frame) return { x: 0, y: 0 }
	const rect = frame.getBoundingClientRect()
	return { x: rect.left, y: rect.top }
}

/**
 * Get native value setter from the element's own prototype (iframe-safe).
 * @note for React
 */
export function getNativeValueSetter(element: HTMLInputElement | HTMLTextAreaElement) {
	let prototype: object | null = Object.getPrototypeOf(element) as object
	while (prototype) {
		// eslint-disable-next-line @typescript-eslint/unbound-method
		const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
		if (setter) return setter as (this: HTMLInputElement | HTMLTextAreaElement, value: string) => void
		prototype = Object.getPrototypeOf(prototype) as object | null
	}
	throw new Error('Native value setter is unavailable for this field')
}

// ======= general utils =======

export async function waitFor(seconds: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
}

// ======= mask events =======

/**
 * Move the visual pointer to a position within an element.
 * @param x - x coordinate in the element's document viewport
 * @param y - y coordinate in the element's document viewport
 */
export async function movePointerToElement(element: HTMLElement, x: number, y: number) {
	const offset = getIframeOffset(element)

	window.dispatchEvent(
		new CustomEvent('PageAgent::MovePointerTo', {
			detail: { x: x + offset.x, y: y + offset.y },
		})
	)

	await waitFor(0.3)
}

export async function clickPointer() {
	window.dispatchEvent(new CustomEvent('PageAgent::ClickPointer'))
}

export async function enablePassThrough() {
	window.dispatchEvent(new CustomEvent('PageAgent::EnablePassThrough'))
}

export async function disablePassThrough() {
	window.dispatchEvent(new CustomEvent('PageAgent::DisablePassThrough'))
}
