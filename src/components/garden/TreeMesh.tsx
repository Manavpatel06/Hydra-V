import { useMemo } from 'react'
import { Color, Quaternion, Vector3 } from 'three'
import type { GardenTree, TreeSpecies } from '../../types/domain'

interface TreeMeshProps {
  tree: GardenTree
  blossomEvent: boolean
}

const SPECIES_COLORS: Record<TreeSpecies, { bark: string; canopy: string; blossom: string }> = {
  birch: { bark: '#d6cab6', canopy: '#5e8e53', blossom: '#efb7ce' },
  bamboo: { bark: '#6f8f53', canopy: '#87ae57', blossom: '#f8d9a3' },
  pine: { bark: '#7a5941', canopy: '#2f673f', blossom: '#c6f0db' },
  oak: { bark: '#6d503e', canopy: '#4a7f49', blossom: '#ffd5ba' },
  rare: { bark: '#3f6b72', canopy: '#3db0a5', blossom: '#ffe685' },
}

const upVector = new Vector3(0, 1, 0)

const blendWithFrost = (hex: string, frostAmount: number): string => {
  const base = new Color(hex)
  const frost = new Color('#d3e8f5')
  return base.lerp(frost, frostAmount).getStyle()
}

const SegmentMesh = ({
  start,
  end,
  radius,
  color,
}: {
  start: [number, number, number]
  end: [number, number, number]
  radius: number
  color: string
}) => {
  const transform = useMemo(() => {
    const startVector = new Vector3(...start)
    const endVector = new Vector3(...end)
    const direction = endVector.clone().sub(startVector)
    const length = Math.max(direction.length(), 0.001)
    const midpoint = startVector.clone().add(endVector).multiplyScalar(0.5)
    const quaternion = new Quaternion().setFromUnitVectors(
      upVector,
      direction.clone().normalize(),
    )

    return {
      position: midpoint,
      quaternion,
      length,
    }
  }, [start, end])

  return (
    <mesh position={transform.position} quaternion={transform.quaternion}>
      <cylinderGeometry args={[radius * 0.68, radius, transform.length, 6]} />
      <meshStandardMaterial color={color} roughness={0.82} metalness={0.03} />
    </mesh>
  )
}

export const TreeMesh = ({ tree, blossomEvent }: TreeMeshProps) => {
  const palette = SPECIES_COLORS[tree.species]
  const barkColor = blendWithFrost(palette.bark, tree.frost)
  const canopyColor = blendWithFrost(palette.canopy, tree.frost * 0.7)

  return (
    <group position={tree.position}>
      {tree.segments.map((segment, index) => (
        <SegmentMesh
          key={`${tree.id}-segment-${index}`}
          start={segment.start}
          end={segment.end}
          radius={segment.radius}
          color={barkColor}
        />
      ))}

      {tree.buds.map((bud, index) => {
        const size = tree.species === 'bamboo' ? 0.06 : 0.09
        const showBlossom = blossomEvent || tree.species === 'rare'

        return (
          <mesh key={`${tree.id}-bud-${index}`} position={bud}>
            <sphereGeometry args={[size, 8, 8]} />
            <meshStandardMaterial
              color={showBlossom ? palette.blossom : canopyColor}
              roughness={0.45}
              metalness={tree.species === 'rare' ? 0.2 : 0.02}
              emissive={showBlossom ? '#402534' : '#1c2b19'}
              emissiveIntensity={showBlossom ? 0.1 : 0.02}
            />
          </mesh>
        )
      })}
    </group>
  )
}
