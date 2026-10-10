// Original dummy text used only to demonstrate extraction and merging.
export const sample = `# Dummy document
# 테스트 문서

English sample line 01: alpha beta gamma.
한국어 예제 줄 01: 가나 다라 마바.

## Sample block
## 예제 묶음

<상자>
English sample line 02: delta epsilon zeta.
한국어 예제 줄 02: 사아 자차 카타.
</상자>

- English sample line 03: nora vemi zalu.
- 한국어 예제 줄 03: 라라 루루 리리.

- English sample line 04: pavo miri tula.
- 한국어 예제 줄 04: 나나 누누 니니.
`;

export function reviseSample(text: string): string {
  return text
    .replace('가나 다라 마바.', '가나 다라 마바 바사.')
    .replace('사아 자차 카타.', '사아 자차 카타 타파.')
    .replace('라라 루루 리리.', '라라 루루 레레.')
    .replace('나나 누누 니니.', '나나 누누 네네.\n- 추가한 한국어 예제 줄: 도도 두두 디디.');
}
