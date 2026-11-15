/* 自动生成，勿手改。运行 npm run gen 重新生成。 */
export interface RawPuzzle {
  id: string
  name: string
  width: number
  height: number
  difficulty: 'easy' | 'medium' | 'hard' | 'custom'
  series: string
  /** 题面编码串（格式由 src/game/puzzles.ts 解析） */
  board: string
  /** 参考解编码串（没有则留空） */
  solution?: string
}

export const RAW_PUZZLES: RawPuzzle[] = [
  { id: "nonogram-6x6-lq7q4h", name: "初织小图", width: 6, height: 6, difficulty: 'easy', series: "入门", board: "1,2;1,1,2;3;1,2;2,1;1,1,1|2,2;1;1,1,1;1;5;4,1", solution: "122211121211222111221211112212121221" },
  { id: "nonogram-7x7-lq7q4i", name: "七行经纬", width: 7, height: 7, difficulty: 'easy', series: "入门", board: "3,2;2,1;3;2,1;2,3;1,1,2;1,3,1|1,5;5;3,2;1,1;1,1;1,2;2,1,2", solution: "1112211211222111122221122221112111212122111211121" },
  { id: "nonogram-8x8-lq7q4j", name: "织影回廊", width: 8, height: 8, difficulty: 'medium', series: "进阶", board: "2,1,2;2,2;2,1,2;2,2,1;1,3;2,3;3,1,1;1,2,1,1|1,1,2;4,2;2,4;1,1;1,2,1;1,4;3,2;1,3,2", solution: "1122121121122112211212111121122122122111211211121112212112112121" },
  { id: "nonogram-8x8-lq7q4k", name: "密线之图", width: 8, height: 8, difficulty: 'medium', series: "进阶", board: "2;4;1,1,2;1,1,1,2;2,1,1;3;1,2,1,1;4,1|2,2;1,2,1;1,1,3;2,4;1,1;2,1;1,2;1,2,2", solution: "2222221122111122212121121212121111212221211122221211212111112221" },
  { id: "nonogram-10x10-lq7q4l", name: "十方织锦", width: 10, height: 10, difficulty: 'hard', series: "挑战", board: "1,2,2;6;2,2,1;1,2,2,2;1,6;3,2,3;3,1,1;1,3,1,2;3,1,2;2,3,1|2,1,3;1,1,3,2;1,1,4;2,2,2;2,2,2;5,1;4,2,1;1,2,1;1,6;1,2,1,3", solution: "2121122211221111112211222112211211211211212111111211121121112111221212121112121111121222111122211121" },
  { id: "nonogram-10x10-lq7q4m", name: "像素终章", width: 10, height: 10, difficulty: 'hard', series: "挑战", board: "1,2,3;1,2,1,1;2,1,2,2;2,2,1;1,3,1;3,3,1;1,4,1;1,4,3;1,3,1;6,2|2,3,1;6,2;3,1;1,3,4;2,7;2,6;1,1,1;2,1,3;1,2,1,1;2,3", solution: "2121121112212211212111212112111121122212212111212211121112211211112221121111211121211121221111112112" },
]
