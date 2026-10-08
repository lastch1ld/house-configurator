import { Line, Text } from "@react-three/drei";

const AXIS_LENGTH = 3;

export function AxisIndicator({ corner }: { corner: [number, number] }) {
  const [cx, cz] = corner;
  const origin: [number, number, number] = [cx, 0.02, cz];

  return (
    <group position={origin}>
      {/* X axis (red) */}
      <Line
        points={[
          [0, 0, 0],
          [AXIS_LENGTH, 0, 0],
        ]}
        color="red"
        lineWidth={2}
      />
      <Text
        position={[AXIS_LENGTH + 0.4, 0, 0]}
        fontSize={0.5}
        color="red"
        anchorX="center"
        anchorY="middle"
      >
        X
      </Text>

      {/* Z axis (blue) */}
      <Line
        points={[
          [0, 0, 0],
          [0, 0, AXIS_LENGTH],
        ]}
        color="blue"
        lineWidth={2}
      />
      <Text
        position={[0, 0, AXIS_LENGTH + 0.4]}
        fontSize={0.5}
        color="blue"
        anchorX="center"
        anchorY="middle"
      >
        Z
      </Text>

      {/* Y axis (green) */}
      <Line
        points={[
          [0, 0, 0],
          [0, AXIS_LENGTH, 0],
        ]}
        color="green"
        lineWidth={2}
      />
      <Text
        position={[0, AXIS_LENGTH + 0.4, 0]}
        fontSize={0.5}
        color="green"
        anchorX="center"
        anchorY="middle"
      >
        Y
      </Text>
    </group>
  );
}
