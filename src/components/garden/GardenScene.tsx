import { Canvas } from '@react-three/fiber'
import { OrbitControls, Sparkles } from '@react-three/drei'
import type { GardenSnapshot } from '../../types/domain'
import { TreeMesh } from './TreeMesh'

interface GardenSceneProps {
  snapshot: GardenSnapshot
  onCanvasReady?: (canvas: HTMLCanvasElement) => void
}

const Ground = ({ frostLevel, biomeUnlocked }: { frostLevel: number; biomeUnlocked: boolean }) => (
  <group>
    <mesh rotation-x={-Math.PI / 2} position={[0, -0.01, 0]}>
      <circleGeometry args={[14, 80]} />
      <meshStandardMaterial color={frostLevel > 0.1 ? '#b7c9cc' : '#d8e5cf'} roughness={1} />
    </mesh>

    {biomeUnlocked && (
      <mesh rotation-x={-Math.PI / 2} position={[0.7, -0.005, 0.8]}>
        <ringGeometry args={[5.8, 7.4, 80]} />
        <meshStandardMaterial color="#8fb998" roughness={0.95} />
      </mesh>
    )}
  </group>
)

const River = () => (
  <mesh rotation-x={-Math.PI / 2} position={[0, 0.015, 0]}>
    <torusGeometry args={[4.6, 0.18, 20, 140]} />
    <meshStandardMaterial color="#64b5c6" roughness={0.25} metalness={0.08} />
  </mesh>
)

const RareSpeciesMarker = () => (
  <mesh position={[0, 0.8, 0]}>
    <icosahedronGeometry args={[0.34, 2]} />
    <meshStandardMaterial color="#f7df75" emissive="#ad7f16" emissiveIntensity={0.42} />
  </mesh>
)

export const GardenScene = ({ snapshot, onCanvasReady }: GardenSceneProps) => (
  <Canvas
    gl={{ antialias: true, preserveDrawingBuffer: true }}
    camera={{ position: [6.4, 4.6, 7.2], fov: 44 }}
    onCreated={(state) => {
      state.gl.setClearColor('#ecf2e8')
      onCanvasReady?.(state.gl.domElement)
    }}
  >
    <ambientLight intensity={0.84} />
    <directionalLight position={[4, 8, 3]} intensity={1.25} />
    <directionalLight position={[-6, 4, -4]} intensity={0.45} color="#f5e9cf" />

    <Ground
      frostLevel={snapshot.milestones.frostLevel}
      biomeUnlocked={snapshot.milestones.biomeUnlocked}
    />

    {snapshot.milestones.equilibriumRiver && <River />}
    {snapshot.milestones.rareSpeciesUnlocked && <RareSpeciesMarker />}
    {snapshot.milestones.blossomEvent && (
      <Sparkles count={90} size={3.5} speed={0.26} scale={[9, 4, 9]} color="#f7b3c8" />
    )}

    {snapshot.trees.map((tree) => (
      <TreeMesh key={tree.id} tree={tree} blossomEvent={snapshot.milestones.blossomEvent} />
    ))}

    <OrbitControls
      minDistance={5}
      maxDistance={13}
      minPolarAngle={Math.PI / 5}
      maxPolarAngle={Math.PI / 2.2}
      enablePan={false}
      target={[0, 1.2, 0]}
    />
  </Canvas>
)
