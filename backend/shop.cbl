      *> ------------------------------------------------------------
      *> NazzGabbikes checkout - COBOL business logic (free format)
      *> Build:  npm run build:cobol   (cobc -x -free)
      *>
      *> Input  (one line on stdin, fixed width, 200 chars):
      *>   col 1      mode: H = health check, C = checkout
      *>   then SIX product records of 21 chars each:
      *>     signed quantity  S9(6) sign leading separate  (7 chars)
      *>     unit price cents 9(8)                         (8 chars)
      *>     current stock    9(6)                         (6 chars)
      *>
      *> Output (one line on stdout, fields separated by "|"):
      *>   OK|HEALTH
      *>   OK|rem1..rem6|line1..line6|total     (checkout success)
      *>   ERR|CODE|nn     CODE = STOCK / BADIN / NEGQT / EMPTY / MODE
      *>                   nn   = product number that caused the error
      *> ------------------------------------------------------------
       IDENTIFICATION DIVISION.
       PROGRAM-ID. NAZZGABBIKES-CHECKOUT.

       ENVIRONMENT DIVISION.

       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-LINE.
          05 WS-MODE            PIC X.
          05 WS-REC OCCURS 6 TIMES.
             10 WS-QTY          PIC S9(6) SIGN LEADING SEPARATE.
             10 WS-PRICE        PIC 9(8).
             10 WS-STOCK        PIC 9(6).
          05 FILLER             PIC X(73).

       01 WS-IDX                PIC 9(2).
       01 WS-ANY                PIC 9 VALUE 0.
       01 WS-ERR                PIC 9 VALUE 0.
       01 WS-ERR-CODE           PIC X(5) VALUE SPACES.
       01 WS-ERR-IDX            PIC 9(2) VALUE 0.
       01 WS-TOTAL              PIC 9(15) VALUE 0.
       01 WS-LINE-TOTAL         PIC 9(14) OCCURS 6 TIMES.
       01 WS-REMAIN             PIC 9(6)  OCCURS 6 TIMES.

       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT WS-LINE FROM CONSOLE
           EVALUATE WS-MODE
               WHEN "H"
                   DISPLAY "OK|HEALTH"
               WHEN "C"
                   PERFORM CHECKOUT-PARA
               WHEN OTHER
                   DISPLAY "ERR|MODE |00"
           END-EVALUATE
           STOP RUN.

       CHECKOUT-PARA.
           PERFORM VALIDATE-PARA
           IF WS-ERR = 0
               PERFORM CALCULATE-PARA
               PERFORM RESPOND-PARA
           ELSE
               DISPLAY "ERR|" WS-ERR-CODE "|" WS-ERR-IDX
           END-IF.

      *> Validation: numeric fields, no negative quantity,
      *> never sell more than the stock, and order must not be empty.
       VALIDATE-PARA.
           MOVE 0 TO WS-ERR
           MOVE 0 TO WS-ANY
           PERFORM VARYING WS-IDX FROM 1 BY 1
                   UNTIL WS-IDX > 6 OR WS-ERR = 1
               EVALUATE TRUE
                   WHEN WS-QTY (WS-IDX) NOT NUMERIC
                     OR WS-PRICE (WS-IDX) NOT NUMERIC
                     OR WS-STOCK (WS-IDX) NOT NUMERIC
                       MOVE 1 TO WS-ERR
                       MOVE "BADIN" TO WS-ERR-CODE
                       MOVE WS-IDX TO WS-ERR-IDX
                   WHEN WS-QTY (WS-IDX) < 0
                       MOVE 1 TO WS-ERR
                       MOVE "NEGQT" TO WS-ERR-CODE
                       MOVE WS-IDX TO WS-ERR-IDX
                   WHEN WS-QTY (WS-IDX) > WS-STOCK (WS-IDX)
                       MOVE 1 TO WS-ERR
                       MOVE "STOCK" TO WS-ERR-CODE
                       MOVE WS-IDX TO WS-ERR-IDX
                   WHEN WS-QTY (WS-IDX) > 0
                       MOVE 1 TO WS-ANY
                   WHEN OTHER
                       CONTINUE
               END-EVALUATE
           END-PERFORM
           IF WS-ERR = 0 AND WS-ANY = 0
               MOVE 1 TO WS-ERR
               MOVE "EMPTY" TO WS-ERR-CODE
               MOVE 0 TO WS-ERR-IDX
           END-IF.

      *> Calculation: line total = qty x price, remaining = stock - qty,
      *> order total = sum of all line totals (all in cents).
       CALCULATE-PARA.
           MOVE 0 TO WS-TOTAL
           PERFORM VARYING WS-IDX FROM 1 BY 1 UNTIL WS-IDX > 6
               COMPUTE WS-LINE-TOTAL (WS-IDX) =
                       WS-QTY (WS-IDX) * WS-PRICE (WS-IDX)
               COMPUTE WS-REMAIN (WS-IDX) =
                       WS-STOCK (WS-IDX) - WS-QTY (WS-IDX)
               ADD WS-LINE-TOTAL (WS-IDX) TO WS-TOTAL
           END-PERFORM.

       RESPOND-PARA.
           DISPLAY "OK" WITH NO ADVANCING
           PERFORM VARYING WS-IDX FROM 1 BY 1 UNTIL WS-IDX > 6
               DISPLAY "|" WS-REMAIN (WS-IDX) WITH NO ADVANCING
           END-PERFORM
           PERFORM VARYING WS-IDX FROM 1 BY 1 UNTIL WS-IDX > 6
               DISPLAY "|" WS-LINE-TOTAL (WS-IDX) WITH NO ADVANCING
           END-PERFORM
           DISPLAY "|" WS-TOTAL.
