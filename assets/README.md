# assets

Empty on purpose.

Every model, texture and sound in HelloCouple World is generated at runtime:
geometry in `js/props.js`, `js/buildings.js`, `js/vegetation.js` and
`js/character.js`; textures in `js/textures.js`; audio in `js/audio.js`.

These folders exist so custom art can be dropped in later without restructuring
the project. The only third-party file that ships is Three.js, vendored under
`vendor/three/` with its MIT licence.
