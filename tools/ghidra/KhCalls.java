// Знайти всі виклики функції(й) KH_ADDRS і витягти сталі аргументи (x64 fastcall:
// RCX/EDX/R8/R9 + lea rdx,[func]). Для таблиць реєстрації обробників:
//   FUN_14027fb90(id, handler) → id ↔ адреса обробника.
// Вивід: KH_OUT/calls.txt (call-site, id, handler, функція-власник).
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.*;
import ghidra.program.model.lang.Register;
import ghidra.program.model.listing.*;
import ghidra.program.model.scalar.Scalar;
import ghidra.program.model.symbol.*;
import java.io.*;
import java.util.*;

public class KhCalls extends GhidraScript {
  @Override
  public void run() throws Exception {
    String outDir = System.getenv("KH_OUT"); if (outDir == null) outDir = "E:/ghidra_out/calls";
    new File(outDir).mkdirs();
    Program p = currentProgram;
    Listing listing = p.getListing();
    ReferenceManager rm = p.getReferenceManager();
    FunctionManager fm = p.getFunctionManager();
    PrintWriter w = new PrintWriter(new OutputStreamWriter(new FileOutputStream(new File(outDir, "calls.txt")), "UTF-8"));
    int total = 0;
    for (String a : System.getenv("KH_ADDRS").split(",")) {
      Address target = p.getAddressFactory().getDefaultAddressSpace().getAddress(Long.parseUnsignedLong(a.trim(), 16));
      for (Reference r : rm.getReferencesTo(target)) {
        if (!r.getReferenceType().isCall()) continue;
        Address site = r.getFromAddress();
        Function owner = fm.getFunctionContaining(site);
        Map<String, String> args = new LinkedHashMap<>();
        Instruction ins = listing.getInstructionAt(site);
        for (int back = 0; back < 16 && ins != null; back++) {
          ins = ins.getPrevious();
          if (ins == null) break;
          String mn = ins.getMnemonicString();
          if (mn.equals("CALL")) break;                       // чужі аргументи
          if (!mn.equals("MOV") && !mn.equals("LEA") && !mn.equals("XOR")) continue;
          Object[] dst = ins.getOpObjects(0);
          if (dst.length == 0 || !(dst[0] instanceof Register)) continue;
          String reg = ((Register) dst[0]).getName().toUpperCase();
          String key = reg.replaceAll("^E", "R").replaceAll("^(R[CDX89]|R[CD]X|R8|R9).*$", "$1");
          if (!reg.startsWith("RC") && !reg.startsWith("EC") && !reg.startsWith("RD") && !reg.startsWith("ED")
              && !reg.startsWith("R8") && !reg.startsWith("R9")) continue;
          if (args.containsKey(key)) continue;
          String val = null;
          if (mn.equals("XOR")) { val = "0"; }
          else {
            for (Object o : ins.getOpObjects(1)) {
              if (o instanceof Scalar) { val = "0x" + Long.toHexString(((Scalar) o).getUnsignedValue()); break; }
              if (o instanceof Address) { val = o.toString(); break; }
            }
            if (val == null && mn.equals("LEA")) {
              Reference[] rr = ins.getReferencesFrom();
              if (rr.length > 0) val = rr[0].getToAddress().toString();
            }
          }
          if (val != null) args.put(key, reg + "=" + val);
        }
        w.println(site + "\t" + (owner == null ? "?" : owner.getName()) + "\t" + String.join(" ", args.values()));
        total++;
      }
    }
    w.close();
    println("KhCalls: " + total + " call sites");
  }
}
